// 彰基醫院自動打卡系統 - Content Script
// 處理網頁 DOM 操作和自動化打卡流程

// 注入外部腳本繞過 CSP 限制
function injectExternalScript() {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('dialog-override.js');
    (document.head || document.documentElement).appendChild(script);
}

// 注入外部腳本
injectExternalScript();

class AutoPunchInHandler {
    constructor() {
        this.isRunning = false;
        this.currentIndex = 0;
        this.workDays = [];
        this.setupMessageListener();
        this.maxRetries = 3;
        this.retryDelay = 1500;
        this.userStopped = false;
        
        // 班別對應表 - 根據實際網頁選項更新
        this.SHIFT_MAPPING = {
            'C02': 'C02：8-17半(無休)',
            'W02': 'W02：六8-12',
            'DW2': 'DW2：平值8-隔日12',
            'DW6': 'DW6：假8-隔日12',
            'DW2H': 'DW2H：平值8-隔日8(次日公休)',
            'DW4': 'DW4：六8-隔日8',
            'N': 'N：8-17半(午休1.5h)'
        };
        
        // 時間設定對應表
        this.TIME_SETTINGS = {
            'C02': { 
                checkIn: { hour: '08', minute: '00' }, 
                checkOut: { hour: '17', minute: '30' }, 
                isOvernight: false,
                description: '一般日班工作'
            },
            'W02': { 
                checkIn: { hour: '08', minute: '00' }, 
                checkOut: { hour: '12', minute: '00' }, 
                isOvernight: false,
                description: '週六半日班'
            },
            'DW2': { 
                checkIn: { hour: '08', minute: '00' }, 
                checkOut: { hour: '12', minute: '00' }, 
                isOvernight: true,
                description: '平日值班工作'
            },
            'DW6': { 
                checkIn: { hour: '08', minute: '00' }, 
                checkOut: { hour: '12', minute: '00' }, 
                isOvernight: true,
                description: '假日值班工作'
            },
            'DW2H': { 
                checkIn: { hour: '08', minute: '00' }, 
                checkOut: { hour: '08', minute: '00' }, 
                isOvernight: true,
                description: '平日值班(次日公休)'
            },
            'DW4': { 
                checkIn: { hour: '08', minute: '00' }, 
                checkOut: { hour: '08', minute: '00' }, 
                isOvernight: true,
                description: '週六值班工作'
            },
            'N': { 
                checkIn: { hour: '08', minute: '00' }, 
                checkOut: { hour: '17', minute: '30' }, 
                isOvernight: false,
                description: '一般日班(含午休)'
            }
        };
    }
    
    checkRunning() {
        return this.isRunning && !this.userStopped;
    }
    
    setupMessageListener() {
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            if (message.type === 'START_AUTOFILL') {
                this.startAutofill(message.data);
                sendResponse({ status: 'started' });
            } else if (message.type === 'STOP_AUTOFILL') {
                this.stopAutofill();
                sendResponse({ status: 'stopped' });
            }
            return true;
        });
    }
    
    stopAutofill() {
        if (this.isRunning) {
            this.isRunning = false;
            this.userStopped = true;
            this.notifyComplete(false, '用戶停止執行');
        }
    }
    
    async startAutofill(workDaysData) {
        if (this.isRunning) {
            // 已經在執行中
            return;
        }
        
        this.isRunning = true;
        this.userStopped = false;
        this.currentIndex = 0;
        this.workDays = workDaysData;
        
        try {
            // 開始處理（進度顯示已足夠）
            
            for (let i = 0; i < this.workDays.length && this.checkRunning(); i++) {
                this.currentIndex = i;
                const workDay = this.workDays[i];
                
                try {
                    await this.processSingleDay(workDay);
                } catch (error) {
                    if (!this.checkRunning()) return;
                }
                
                this.updateProgress(i + 1, this.workDays.length);
                
                if (i < this.workDays.length - 1) {
                    await this.sleep(800);
                }
            }
            
            // 所有打卡記錄處理完成
            this.notifyComplete(true);
            
            // 確保所有處理完全結束，停止任何後續操作
            this.logMessage('自動打卡完成！', 'success');
            
        } catch (error) {
            if (this.userStopped) {
                // 用戶停止，不當作錯誤處理
                return;
            }
            // 執行過程發生錯誤（實際上很少觸發）
            this.notifyComplete(false, error.message);
        } finally {
            this.isRunning = false;
            this.userStopped = false;
        }
    }
    
    async processSingleDay(workDay) {
        for (let retryCount = 0; retryCount < this.maxRetries; retryCount++) {
            if (!this.checkRunning()) return;
            
            try {
                const editButton = await this.findEditButtonByDate(workDay.date);
                if (!editButton) {
                    if (!this.checkRunning()) return;
                    throw new Error(`找不到 ${workDay.date} 號的編輯按鈕`);
                }
                
                if (!this.checkRunning()) return;
                
                editButton.click();
                await this.sleep(1000);
                
                const dialog = await this.waitForDialogWithValidation(5000);
                if (!dialog) {
                    if (!this.checkRunning()) return;
                    throw new Error('打卡對話框未出現或驗證失敗');
                }
                
                if (!this.checkRunning()) return;
                
                await this.fillPunchInData(dialog, workDay);
                
                if (!this.checkRunning()) return;
                
                await this.submitForm(dialog);
                await this.waitForDialogCloseWithValidation();
                
                return; // 成功完成
                
            } catch (error) {
                if (!this.checkRunning()) return;
                
                this.logMessage(`處理 ${workDay.date} 號時發生錯誤: ${error.message}（正在自動重試...）`, 'warning');
                
                if (retryCount < this.maxRetries - 1) {
                    await this.sleep(this.retryDelay);
                    await this.ensureDialogClosed();
                } else {
                    if (!this.checkRunning()) return;
                    throw new Error(`處理 ${workDay.date} 號失敗，已重試 ${this.maxRetries} 次: ${error.message}`);
                }
            }
        }
    }
    
    async findEditButtonByDate(date) {
        // 尋找編輯按鈕
        
        try {
            // 智能等待Angular Material表格載入完成
            const tableFound = await this.waitForCondition(() => {
                const matRow = document.querySelector('mat-row');
                return matRow !== null;
            }, 5000, 100, 'Angular Material表格載入');
            
            if (!tableFound) {
                throw new Error('找不到打卡記錄表格');
            }
            
            // 超高效查找：第 N 天 = Angular Material表格第 N 行的第一個按鈕
            const editButton = document.querySelector(`mat-row:nth-child(${date}) button`);
            
            if (!editButton) {
                throw new Error(`找不到第 ${date} 天的編輯按鈕`);
            }
            
            // 成功找到編輯按鈕
            return editButton;
            
        } catch (error) {
            this.logMessage(`查找編輯按鈕失敗: ${error.message}`, 'error');
            return null;
        }
    }
    
    
    async fillPunchInData(dialog, workDay) {
        let timeSetting = this.TIME_SETTINGS[workDay.shift];
        if (!timeSetting) {
            throw new Error(`未知的班別: ${workDay.shift}`);
        }
        
        // 如果是加班日，動態調整C02班別的簽退時間
        if (workDay.isOvertime && workDay.shift === 'C02') {
            timeSetting = {
                ...timeSetting,
                checkOut: { hour: '20', minute: '00' },
                description: '加班日工作'
            };
        }
        
        // 開始填寫班別資料
        
        // 1. 設定班別（跳過部門選擇，保持預設值）
        await this.selectShift(dialog, workDay.shift);
        // 移除固定延遲，直接進行下一步
        
        // 2. 設定簽退時間
        await this.setCheckOutTime(dialog, timeSetting.checkOut, timeSetting.isOvernight);
        // 移除固定延遲，提升響應速度
        
        // 已完成班別設定
    }
    
    async selectShift(dialog, shift) {
        const shiftName = this.SHIFT_MAPPING[shift];
        if (!shiftName) {
            throw new Error(`未知的班別對應: ${shift}`);
        }
        
        // 開始選擇班別
        
        try {
            // 優先查找原生 select 元素
            const shiftSelect = dialog.querySelector('select[aria-label="班別"]');
            
            if (shiftSelect) {
                // 原生 select 元素的處理方式
                // 找到原生 select 元素
                
                // 直接設定值
                shiftSelect.value = shift;
                shiftSelect.dispatchEvent(new Event('change', { bubbles: true }));
                
                // 成功選擇班別
                await this.sleep(200);
                return;
            }
            
            // 查找班別的 combobox 元素 
            const comboboxes = dialog.querySelectorAll('[role="combobox"]');
            // 找到 combobox
            
            if (comboboxes.length >= 2) {
                // 第二個 combobox 通常是班別選擇器（第一個是部門）
                const shiftCombobox = comboboxes[1];
                // 找到班別 combobox 選擇器
                
                // 使用 combobox 專用方法選擇班別
                await this.selectDropdownValue(shiftCombobox, shiftName, '班別', 'combobox');
                return;
            } else {
                throw new Error(`combobox 數量不足，預期至少2個，實際找到 ${comboboxes.length} 個`);
            }
            
            this.logMessage(`成功選擇班別: ${shiftName}`, 'success');
            await this.sleep(200);
            
        } catch (error) {
            this.logMessage(`選擇班別失敗: ${error.message}`, 'error');
            throw error;
        }
    }
    
    
    async setCheckOutTime(dialog, timeSettings, isOvernight) {
        // 設定簽退時間
        
        try {
            // 如果是跨夜班別，需要先設定簽退日期
            if (isOvernight) {
                await this.setCheckOutDate(dialog);
                await this.sleep(200);
            }
            
            // 查找簽退時間的 mat-select 元素
            const allMatSelects = dialog.querySelectorAll('mat-select[name="HourStart"], mat-select[name="MinuteStart"]');
            // 找到時間相關的 mat-select 元素
            
            // 記錄所有時間相關元素的信息
            for (let i = 0; i < allMatSelects.length; i++) {
                const element = allMatSelects[i];
                const id = element.id || 'no-id';
                const name = element.getAttribute('name') || 'no-name';
                // 時間選擇器資訊
            }
            
            if (allMatSelects.length >= 4) {
                // 假設後兩個是簽退時間：簽退小時、簽退分鐘
                const hourSelect = allMatSelects[2];  // 第3個是簽退小時
                const minuteSelect = allMatSelects[3]; // 第4個是簽退分鐘
                
                // 使用第3、4個時間選擇器作為簽退時間
                
                // 設定簽退小時
                await this.selectDropdownValue(hourSelect, timeSettings.hour, '簽退小時', 'matselect');
                await this.sleep(200);
                
                // 設定簽退分鐘
                await this.selectDropdownValue(minuteSelect, timeSettings.minute, '簽退分鐘', 'matselect');
            } else {
                throw new Error(`時間相關的 mat-select 數量不足，預期至少4個，實際 ${allMatSelects.length} 個`);
            }
            
        } catch (error) {
            this.logMessage(`設定簽退時間失敗: ${error.message}`, 'error');
            throw error;
        }
    }
    
    // 統一的下拉選單處理函數
    async selectDropdownValue(element, value, fieldName, type) {
        if (!this.isRunning) return;
        
        try {
            const paddedValue = String(value).padStart(2, '0');
            const searchValues = [paddedValue, String(parseInt(value)), value];
            
            // 檢查當前值是否已正確
            const currentValue = this.getCurrentValue(element, type);
            if (searchValues.includes(currentValue)) return;
            
            // 點擊打開下拉選單
            this.clickDropdownTrigger(element, type);
            await this.sleep(300);
            
            // 等待選項出現
            const options = await this.waitForOptions(type, fieldName);
            if (!options.length) {
                throw new Error(`${fieldName}: 選項未在預期時間內出現`);
            }
            
            // 選擇目標值
            const found = this.selectOptionByValue(options, searchValues);
            if (!found) {
                const availableOptions = options.map(opt => opt.textContent?.trim() || '').filter(text => text).join(', ');
                throw new Error(`${fieldName}: 找不到值 "${value}"。可用選項: [${availableOptions}]`);
            }
            
            await this.sleep(150);
            
        } catch (error) {
            this.logMessage(`${fieldName}: 設定失敗: ${error.message}`, 'error');
            throw error;
        }
    }
    
    getCurrentValue(element, type) {
        if (type === 'combobox') {
            const currentValueElement = element.querySelector('generic');
            return currentValueElement?.textContent?.trim() || '';
        } else {
            const valueSelectors = ['.mat-mdc-select-min-line', '.mat-mdc-select-value-text', '.mat-select-value-text'];
            for (const selector of valueSelectors) {
                const valueElement = element.querySelector(selector);
                if (valueElement?.textContent?.trim()) {
                    return valueElement.textContent.trim();
                }
            }
        }
        return '';
    }
    
    clickDropdownTrigger(element, type) {
        if (type === 'combobox') {
            element.click();
        } else {
            const trigger = element.querySelector('.mat-mdc-select-trigger');
            (trigger || element).click();
        }
    }
    
    async waitForOptions(type, fieldName) {
        const selectors = type === 'combobox' ? ['option'] : ['mat-option', '.mat-option', '[role="option"]'];
        
        let options = [];
        const appeared = await this.waitForCondition(() => {
            for (const selector of selectors) {
                const foundOptions = document.querySelectorAll(selector);
                if (foundOptions.length > 0) {
                    options = Array.from(foundOptions);
                    return true;
                }
            }
            return false;
        }, 3000, 150, `${fieldName} 選項出現`);
        
        return appeared ? options : [];
    }
    
    selectOptionByValue(options, searchValues) {
        for (const option of options) {
            const optionText = option.textContent?.trim() || '';
            if (searchValues.includes(optionText)) {
                option.click();
                return true;
            }
        }
        return false;
    }
    
    
    async setCheckOutDate(dialog) {
        // 找到簽退日期的日曆按鈕
        const calendarButtons = dialog.querySelectorAll('button[aria-label*="Open calendar"]');
        
        if (calendarButtons.length >= 2) {
            const checkOutCalendarButton = calendarButtons[1]; // 第二個是簽退日期
            // 點擊簽退日期日曆按鈕
            checkOutCalendarButton.click();
            await this.sleep(200);
            
            // 智能等待日曆展開
            await this.waitForCondition(() => {
                const calendarGrid = document.querySelector('gridcell button, .mat-calendar-body');
                return calendarGrid !== null;
            }, 3000, 100, '日曆展開');
            
            // 計算隔日日期 - 從簽到日期輸入框獲取工作日期
            const checkinDateInput = dialog.querySelector('textbox[disabled]') || 
                                   dialog.querySelector('input[disabled]');
            
            let workDateText = '';
            if (checkinDateInput) {
                workDateText = checkinDateInput.value || checkinDateInput.textContent || checkinDateInput.innerText || '';
                // 從簽到日期獲取工作日期
            }
            
            // 如果還是沒找到，從工作日顯示區域獲取
            if (!workDateText) {
                const workDayElements = dialog.querySelectorAll('generic');
                for (const elem of workDayElements) {
                    const text = elem.textContent || '';
                    if (text.match(/^\d{4}-\d{2}-\d{2}$/)) {
                        workDateText = text.replace(/-/g, '/');
                        // 從工作日顯示區域獲取日期
                        break;
                    }
                }
            }
            
            let workDate;
            if (workDateText && workDateText.includes('/')) {
                // 解析工作日期，格式如 "2025/08/02"
                const dateParts = workDateText.split('/');
                workDate = new Date(parseInt(dateParts[0]), parseInt(dateParts[1]) - 1, parseInt(dateParts[2]));
                // 解析工作日期
            } else {
                // 備用方案：使用當前日期
                workDate = new Date();
                // 無法解析工作日期，使用當前日期
            }
            
            const tomorrow = new Date(workDate);
            tomorrow.setDate(tomorrow.getDate() + 1);
            // 計算隔日
            
            const targetYear = tomorrow.getFullYear();
            const targetMonth = tomorrow.getMonth() + 1; // JavaScript month is 0-based
            const targetDate = tomorrow.getDate();
            
            // 構建目標日期字符串，格式如 "2025/08/02"
            const targetDateStr = `${targetYear}/${String(targetMonth).padStart(2, '0')}/${String(targetDate).padStart(2, '0')}`;
            
            // 尋找隔日日期
            
            // 檢查是否需要導航到下個月（當隔日是下個月第一天時）
            const workMonth = workDate.getMonth();
            const targetMonthIndex = tomorrow.getMonth();
            
            if (targetMonthIndex !== workMonth) {
                // 隔日在下個月，需要導航
                
                // 查找並點擊"下個月"按鈕
                const nextMonthBtn = document.querySelector('button[aria-label*="Next month"], .mat-calendar-next-button') ||
                                   document.querySelector('button[title*="Next"], button[title*="下個月"]');
                if (nextMonthBtn) {
                    // 點擊下個月按鈕
                    nextMonthBtn.click();
                    // 智能等待日曆更新到下個月
                    await this.waitForCondition(() => {
                        const dateButtons = document.querySelectorAll('button[aria-label*="2025/"]');
                        return dateButtons.length > 0;
                    }, 2000, 100, '日曆更新到下個月');
                } else {
                    // 找不到下個月按鈕，嘗試其他方法
                    // 嘗試其他可能的選擇器
                    const possibleNextBtns = document.querySelectorAll('button');
                    for (const btn of possibleNextBtns) {
                        const btnText = (btn.textContent || '').toLowerCase();
                        const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
                        const title = (btn.getAttribute('title') || '').toLowerCase();
                        
                        if (btnText.includes('next') || ariaLabel.includes('next') || title.includes('next') ||
                            btnText.includes('下') || ariaLabel.includes('下') || 
                            btn.querySelector('mat-icon, [class*="arrow"], [class*="chevron"]')) {
                            // 嘗試點擊可能的下個月按鈕
                            btn.click();
                            await this.sleep(1000);
                            break;
                        }
                    }
                }
            }
            
            // 查找對應的日期按鈕（使用 aria-label）
            const dateButtons = document.querySelectorAll('button[aria-label*="2025/"]');
            let targetButton = null;
            
            for (const btn of dateButtons) {
                if (btn.getAttribute('aria-label') === targetDateStr) {
                    targetButton = btn;
                    break;
                }
            }
            
            if (!targetButton) {
                // 備用方法：查找包含目標日期數字的按鈕
                const allButtons = document.querySelectorAll('gridcell button');
                for (const btn of allButtons) {
                    const btnText = btn.textContent.trim();
                    if (btnText === String(targetDate)) {
                        targetButton = btn;
                        break;
                    }
                }
            }
            
            if (targetButton) {
                // 點擊隔日日期
                targetButton.click();
                await this.sleep(200);
            } else {
                throw new Error(`找不到隔日日期按鈕: ${targetDate}`);
            }
        } else {
            throw new Error('找不到簽退日期日曆按鈕');
        }
    }
    
    
    
    async waitForDialogWithValidation(timeout = 5000) {
        const startTime = Date.now();
        const dialogSelectors = ['[role="dialog"]', '.mat-dialog-container', '.modal-dialog', '[aria-modal="true"]'];
        
        while (Date.now() - startTime < timeout && this.checkRunning()) {
            for (const selector of dialogSelectors) {
                const dialog = document.querySelector(selector);
                if (dialog) {
                    const hasTitle = dialog.querySelector('h1, h2, h3, .mat-dialog-title, [role="heading"], .modal-title');
                    const hasContent = dialog.querySelector('form, .mat-dialog-content, .modal-body, .dialog-content');
                    const hasSelects = dialog.querySelectorAll('select, [role="combobox"]').length > 0;
                    
                    if ((hasTitle || hasContent) && hasSelects) {
                        await this.sleep(300);
                        return dialog;
                    }
                }
            }
            await this.sleep(200);
        }
        
        return null;
    }
    
    async waitForDialogCloseWithValidation() {
        const dialogClosed = await this.waitForCondition(() => {
            if (!this.checkRunning()) return true;
            return !document.querySelector('[role="dialog"]');
        }, 5000, 50, '對話框關閉');
        
        if (!dialogClosed && this.checkRunning()) {
            throw new Error('對話框未在預期時間內關閉');
        }
    }
    
    async ensureDialogClosed() {
        const dialog = document.querySelector('[role="dialog"]');
        if (dialog && this.checkRunning()) {
            let cancelButton = dialog.querySelector('button[mat-dialog-close]');
            
            if (!cancelButton) {
                const buttons = dialog.querySelectorAll('button');
                cancelButton = Array.from(buttons).find(btn => 
                    btn.textContent && btn.textContent.trim().includes('取消')
                );
            }
            
            if (cancelButton) {
                cancelButton.click();
            } else {
                document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
            }
            await this.sleep(800);
        }
    }
    
    async submitForm(dialog) {
        if (!this.checkRunning()) return;
        
        try {
            // 確保只在打卡對話框內尋找送出按鈕，避免點擊頁面上方的"送出申請"按鈕
            // 在打卡對話框內尋找送出按鈕
            
            const buttons = dialog.querySelectorAll('button');
            let submitButton = null;
            
            // 優先查找包含"送出"文字但不包含"申請"的按鈕
            for (const btn of buttons) {
                const buttonText = btn.textContent ? btn.textContent.trim() : '';
                
                // 明確排除"送出申請"按鈕，只要"送出"按鈕
                if (buttonText === '送出') {
                    submitButton = btn;
                    // 找到對話框內的送出按鈕
                    break;
                } else if (buttonText === '確認' || buttonText === '提交' || buttonText === '儲存') {
                    submitButton = btn;
                    // 找到替代提交按鈕
                    break;
                }
            }
            
            if (!submitButton) {
                const availableButtons = Array.from(buttons).map(btn => 
                    `"${btn.textContent ? btn.textContent.trim() : '[空白]'}"`
                ).join(', ');
                throw new Error(`在對話框內找不到送出按鈕。可用按鈕: ${availableButtons}`);
            }
            
            // 檢查按鈕是否可點擊
            if (submitButton.disabled) {
                throw new Error('送出按鈕已停用');
            }
            
            // 確認這是對話框內的按鈕
            const isInsideDialog = dialog.contains(submitButton);
            if (!isInsideDialog) {
                throw new Error('找到的按鈕不在對話框內，安全起見拒絕點擊');
            }
            
            // 點擊對話框內的送出按鈕提交打卡資料
            submitButton.click();
            
            // 等待確認對話框出現並自動處理
            await this.sleep(300);
            
            // 處理提交後的確認對話框
            await this.handleConfirmationDialog();
            
        } catch (error) {
            this.logMessage(`提交表單失敗: ${error.message}`, 'error');
            throw error;
        }
    }
    
    async handleConfirmationDialog() {
        // 瀏覽器原生確認對話框已由 dialog-override.js 自動處理
        // 等待300ms確保 alert 處理完成
        await this.sleep(300);
    }
    
    
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    
    /**
     * 智能等待 - 等待條件滿足而非固定時間
     * @param {Function} condition - 條件檢查函數，返回 true 表示條件滿足
     * @param {number} timeout - 最大等待時間（毫秒）
     * @param {number} interval - 檢查間隔（毫秒）
     * @param {string} description - 等待描述（用於日誌）
     * @returns {Promise<boolean>} 條件是否滿足
     */
    async waitForCondition(condition, timeout = 5000, interval = 100, description = '') {
        const startTime = Date.now();
        
        while (Date.now() - startTime < timeout && this.checkRunning()) {
            try {
                if (await condition()) return true;
            } catch (error) {
                // 條件檢查失敗，繼續等待
            }
            await this.sleep(interval);
        }
        
        return false;
    }
    
    /**
     * 快速等待元素出現
     * @param {string} selector - 元素選擇器
     * @param {number} timeout - 最大等待時間
     * @returns {Promise<Element|null>} 找到的元素
     */
    
    notifyComplete(success, error = null) {
        this.sendMessageSafely({
            type: 'AUTOFILL_COMPLETE',
            success: success,
            error: error
        });
    }
    
    logMessage(message, type = 'info') {
        // 當用戶停止執行時，除了關鍵訊息外，過濾所有日誌
        if (!this.isRunning && !message.includes('用戶停止執行')) {
            return;
        }
        
        this.sendMessageSafely({
            type: 'LOG_MESSAGE',
            message: message,
            messageType: type,
            timestamp: new Date().toLocaleTimeString()
        });
    }
    
    updateProgress(current, total) {
        this.sendMessageSafely({
            type: 'UPDATE_PROGRESS',
            current: current,
            total: total,
            percentage: Math.round((current / total) * 100)
        });
    }
    
    sendMessageSafely(message) {
        try {
            chrome.runtime.sendMessage(message, (response) => {
                // 檢查是否有錯誤
                if (chrome.runtime.lastError) {
                    // popup 已關閉或不存在，這是正常情況
                }
            });
        } catch (error) {
            // 忽略通信錯誤
        }
    }
}

// 初始化自動打卡處理器
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        new AutoPunchInHandler();
    });
} else {
    new AutoPunchInHandler();
}

// 檢查是否在正確的頁面
if (window.location.href.includes('dpt.cch.org.tw/EIP')) {
} else {
}