// 彰基醫院自動打卡系統 - Content Script
// 處理網頁 DOM 操作和自動化打卡流程

// 使用 eval 或其他方式繞過 CSP 限制
console.log('[彰基自動打卡] Content script 載入');

// 方法1: 使用外部腳本文件
function injectExternalScript() {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('dialog-override.js');
    (document.head || document.documentElement).appendChild(script);
    console.log('[彰基自動打卡] 外部腳本注入完成');
}

// 方法2: 監聽並攔截原生對話框事件（備用）
function setupDialogInterception() {
    // 監聽頁面中的所有點擊事件，在送出按鈕被點擊後處理對話框
    document.addEventListener('click', function(event) {
        if (event.target.textContent === '送出' || event.target.innerText === '送出') {
            console.log('[彰基自動打卡] 檢測到送出按鈕點擊，準備處理對話框');
            
            // 延遲處理對話框
            setTimeout(() => {
                // 嘗試找到並點擊確定按鈕
                const confirmButton = document.querySelector('button:contains("確定")') || 
                                    document.querySelector('button:contains("OK")') ||
                                    document.querySelector('[role="button"]:contains("確定")');
                
                if (confirmButton) {
                    confirmButton.click();
                    console.log('[彰基自動打卡] 自動點擊確定按鈕');
                }
            }, 500);
        }
    }, true);
}

// 嘗試外部腳本注入
try {
    injectExternalScript();
} catch (error) {
    console.log('[彰基自動打卡] 外部腳本注入失敗，使用備用方案');
    setupDialogInterception();
}

class AutoPunchInHandler {
    constructor() {
        this.isRunning = false;
        this.currentIndex = 0;
        this.workDays = [];
        this.setupMessageListener();
        this.maxRetries = 3; // 最大重試次數
        this.retryDelay = 2000; // 重試延遲（毫秒）
        this.confirmOverrideSetup = false; // 防止重複設置對話框覆寫
        
        // 初始化時設置對話框覆寫（只設置一次）
        this.setupConfirmOverride();
        
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
    
    setupMessageListener() {
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            if (message.type === 'START_AUTOFILL') {
                this.startAutofill(message.data);
                sendResponse({ status: 'started' });
            }
            return true;
        });
    }
    
    setupConfirmOverride() {
        // 檢查是否已經設置過，避免重複設置
        if (this.confirmOverrideSetup) {
            return;
        }
        
        // 保存原始的confirm和alert函數
        this.originalConfirm = window.confirm;
        this.originalAlert = window.alert;
        
        // 使用 Object.defineProperty 來強制覆蓋，防止被其他代碼重新設定
        Object.defineProperty(window, 'confirm', {
            value: (message) => {
                this.logMessage(`自動確認confirm對話框: "${message}"`, 'info');
                setTimeout(() => {
                    // 嘗試查找並點擊確認按鈕（備用方案）
                    this.clickConfirmButton();
                }, 100);
                return true; // 自動點擊確認
            },
            writable: true,
            configurable: true
        });
        
        Object.defineProperty(window, 'alert', {
            value: (message) => {
                this.logMessage(`自動確認alert對話框: "${message}"`, 'info');
                setTimeout(() => {
                    // 嘗試查找並點擊確認按鈕（備用方案）
                    this.clickConfirmButton();
                }, 100);
                // alert不需要返回值，直接結束即可
            },
            writable: true,
            configurable: true
        });
        
        // 同時設置事件監聽器來捕獲任何可能的對話框
        document.addEventListener('click', this.handleDialogEvents.bind(this), true);
        
        // 標記為已設置，避免重複設置
        this.confirmOverrideSetup = true;
        this.logMessage('對話框覆寫設置完成', 'info');
    }
    
    clickConfirmButton() {
        // 嘗試查找頁面上的確認按鈕並點擊
        const confirmButtons = [
            'button:contains("確定")',
            'button:contains("確認")', 
            'button:contains("OK")',
            '[role="button"]:contains("確定")',
            '[role="button"]:contains("確認")',
            '.swal2-confirm', // SweetAlert2
            '.confirm-button',
            '.modal-confirm'
        ];
        
        for (const selector of confirmButtons) {
            try {
                // 對於 :contains 選擇器，需要手動查找
                if (selector.includes(':contains')) {
                    const text = selector.match(/:contains\("([^"]+)"\)/)[1];
                    const buttons = document.querySelectorAll('button, [role="button"]');
                    for (const btn of buttons) {
                        if (btn.textContent && btn.textContent.trim() === text && btn.offsetHeight > 0) {
                            this.logMessage(`找到並點擊確認按鈕: "${text}"`, 'info');
                            btn.click();
                            return;
                        }
                    }
                } else {
                    const btn = document.querySelector(selector);
                    if (btn && btn.offsetHeight > 0) {
                        this.logMessage(`找到並點擊確認按鈕: ${selector}`, 'info');
                        btn.click();
                        return;
                    }
                }
            } catch (e) {
                // 忽略選擇器錯誤
            }
        }
    }
    
    handleDialogEvents(event) {
        // 監聽可能觸發對話框的事件
        if (event.target && event.target.textContent) {
            const text = event.target.textContent.trim();
            if (text === '送出' || text === '提交') {
                setTimeout(() => {
                    this.setupConfirmOverride(); // 重新設置攔截器
                }, 50);
            }
        }
    }
    
    
    restoreOriginalDialogs() {
        // 恢復原始的confirm和alert函數
        if (this.originalConfirm) {
            window.confirm = this.originalConfirm;
        }
        if (this.originalAlert) {
            window.alert = this.originalAlert;
        }
        this.logMessage('已恢復原始瀏覽器對話框', 'info');
    }
    
    async startAutofill(workDaysData) {
        if (this.isRunning) {
            this.logMessage('已經在執行中，請稍候...', 'warning');
            return;
        }
        
        this.isRunning = true;
        this.currentIndex = 0;
        this.workDays = workDaysData;
        
        try {
            this.logMessage(`開始處理 ${this.workDays.length} 天的打卡記錄`, 'info');
            
            for (let i = 0; i < this.workDays.length; i++) {
                this.currentIndex = i;
                const workDay = this.workDays[i];
                
                this.logMessage(`處理第 ${i + 1}/${this.workDays.length} 天: ${workDay.dateStr}`, 'info');
                this.updateProgress(i, this.workDays.length);
                
                await this.processSingleDay(workDay);
                
                // 每天處理完後稍作等待
                await this.sleep(1000);
            }
            
            this.logMessage('所有打卡記錄處理完成！', 'success');
            this.updateProgress(this.workDays.length, this.workDays.length);
            this.notifyComplete(true);
            
        } catch (error) {
            this.logMessage(`執行過程發生錯誤: ${error.message}`, 'error');
            console.error('自動打卡錯誤:', error);
            this.notifyComplete(false, error.message);
        } finally {
            this.isRunning = false;
        }
    }
    
    async processSingleDay(workDay) {
        let retryCount = 0;
        
        while (retryCount < this.maxRetries) {
            try {
                // 0. 等待頁面載入完成
                await this.waitForElement('table tbody tr', 5000);
                
                // 1. 找到對應日期的編輯按鈕
                const editButton = await this.findEditButtonByDate(workDay.date);
                if (!editButton) {
                    throw new Error(`找不到 ${workDay.date} 號的編輯按鈕`);
                }
                
                // 2. 點擊編輯按鈕
                this.logMessage(`點擊 ${workDay.date} 號的編輯按鈕`, 'info');
                editButton.click();
                
                // 3. 等待對話框出現並驗證
                const dialog = await this.waitForDialogWithValidation(5000);
                if (!dialog) {
                    throw new Error('打卡對話框未出現或驗證失敗');
                }
                
                // 4. 填寫打卡資料
                await this.fillPunchInData(dialog, workDay);
                
                // 5. 提交表單
                await this.submitForm(dialog);
                
                // 6. 等待對話框關閉並驗證結果
                await this.waitForDialogCloseWithValidation();
                
                this.logMessage(`${workDay.date} 號打卡完成`, 'success');
                return; // 成功完成，退出重試循環
                
            } catch (error) {
                retryCount++;
                this.logMessage(`處理 ${workDay.date} 號時發生錯誤: ${error.message}`, 'warning');
                
                if (retryCount < this.maxRetries) {
                    this.logMessage(`準備重試 (${retryCount}/${this.maxRetries})`, 'info');
                    await this.sleep(this.retryDelay);
                    
                    // 確保對話框已關閉
                    await this.ensureDialogClosed();
                } else {
                    throw new Error(`處理 ${workDay.date} 號失敗，已重試 ${this.maxRetries} 次: ${error.message}`);
                }
            }
        }
    }
    
    async findEditButtonByDate(date) {
        const dateStr = String(date).padStart(2, '0');
        const currentMonth = new Date().getMonth() + 1;
        const currentYear = new Date().getFullYear();
        const targetDateText = `${String(currentMonth).padStart(2, '0')}/${dateStr}`;
        const fullDateText = `${currentYear}/${targetDateText}`;
        
        this.logMessage(`尋找日期 ${targetDateText} 的編輯按鈕`, 'info');
        
        try {
            // 等待表格載入完成
            await this.sleep(1000); // 確保頁面穩定
            
            // 嘗試多種選擇器找到表格
            let table = document.querySelector('table tbody');
            if (!table) {
                table = document.querySelector('.mat-table tbody');
            }
            if (!table) {
                table = document.querySelector('[role="table"]');
            }
            if (!table) {
                // 最後嘗試找到任何包含行的容器
                const allRows = document.querySelectorAll('tr[role="row"], tr');
                if (allRows.length > 0) {
                    table = allRows[0].parentElement;
                }
            }
            
            if (!table) {
                throw new Error('找不到打卡記錄表格');
            }
            
            // 獲取所有行
            const rows = document.querySelectorAll('tr, [role="row"]');
            this.logMessage(`找到 ${rows.length} 個表格行`, 'info');
            
            // 優先精確匹配
            for (const row of rows) {
                const rowText = row.textContent || '';
                
                // 檢查多種日期格式
                if (rowText.includes(targetDateText) || 
                    rowText.includes(fullDateText) ||
                    rowText.includes(`${dateStr}日`) ||
                    rowText.includes(`第${dateStr}天`)) {
                    
                    this.logMessage(`找到包含日期 ${targetDateText} 的行`, 'info');
                    
                    // 查找該行的編輯按鈕
                    const button = await this.findEditButtonInRow(row);
                    if (button) {
                        this.logMessage(`成功找到 ${targetDateText} 的編輯按鈕`, 'success');
                        return button;
                    }
                }
            }
            
            // 備用方法：按位置查找（第N行對應第N天）
            if (rows.length >= date) {
                const targetRow = rows[date - 1]; // 0-based index
                const button = await this.findEditButtonInRow(targetRow);
                if (button) {
                    this.logMessage(`使用位置匹配找到第 ${date} 天的編輯按鈕`, 'success');
                    return button;
                }
            }
            
            throw new Error(`未找到 ${targetDateText} 的編輯按鈕`);
            
        } catch (error) {
            this.logMessage(`查找編輯按鈕失敗: ${error.message}`, 'error');
            return null;
        }
    }
    
    async findEditButtonInRow(row) {
        // 查找該行中的所有按鈕
        const buttons = row.querySelectorAll('button');
        
        for (const button of buttons) {
            // 多種方式檢查是否為編輯按鈕
            const buttonText = button.textContent?.trim().toLowerCase() || '';
            const ariaLabel = button.getAttribute('aria-label')?.toLowerCase() || '';
            const title = button.title?.toLowerCase() || '';
            
            // 檢查圖標
            const img = button.querySelector('img');
            const icon = button.querySelector('i, svg, mat-icon');
            
            const hasEditIcon = img && (
                img.textContent === 'edit' || 
                img.alt === 'edit' ||
                img.src?.includes('edit')
            );
            
            const hasEditMaterialIcon = icon && (
                icon.textContent === 'edit' ||
                icon.className?.includes('edit') ||
                icon.innerHTML?.includes('edit')
            );
            
            // 檢查文字內容
            const hasEditText = buttonText === 'edit' || 
                              buttonText === '編輯' || 
                              buttonText === '修改' ||
                              buttonText.includes('edit');
            
            // 檢查屬性
            const hasEditAttribute = ariaLabel.includes('edit') || 
                                   ariaLabel.includes('編輯') ||
                                   title.includes('edit') ||
                                   title.includes('編輯');
            
            // 檢查是否為第一個按鈕（通常是編輯按鈕）
            const isFirstButton = button === row.querySelector('button');
            
            // 檢查按鈕類名
            const hasEditClass = button.className?.includes('edit') || 
                               button.className?.includes('modify');
            
            if (hasEditIcon || hasEditMaterialIcon || hasEditText || 
                hasEditAttribute || isFirstButton || hasEditClass) {
                // 檢查按鈕是否可點擊
                if (!button.disabled && button.offsetParent !== null) {
                    this.logMessage('找到編輯按鈕', 'info');
                    return button;
                }
            }
        }
        
        // 如果沒找到按鈕，嘗試查找可點擊的圖標或鏈接
        const clickableElements = row.querySelectorAll('a, [role="button"], [onclick]');
        for (const element of clickableElements) {
            const text = element.textContent?.toLowerCase() || '';
            if (text.includes('edit') || text.includes('編輯')) {
                this.logMessage('找到可點擊的編輯元素', 'info');
                return element;
            }
        }
        
        return null;
    }
    
    async fillPunchInData(dialog, workDay) {
        const timeSetting = this.TIME_SETTINGS[workDay.shift];
        if (!timeSetting) {
            throw new Error(`未知的班別: ${workDay.shift}`);
        }
        
        this.logMessage(`開始填寫 ${workDay.shift} 班別資料`, 'info');
        
        // 1. 設定班別（跳過部門選擇，保持預設值）
        await this.selectShift(dialog, workDay.shift);
        await this.sleep(500);
        
        
        // 2. 設定簽退時間
        await this.setCheckOutTime(dialog, timeSetting.checkOut, timeSetting.isOvernight);
        await this.sleep(500);
        
        this.logMessage(`已完成 ${workDay.shift} 班別的所有設定`, 'info');
    }
    
    async selectShift(dialog, shift) {
        const shiftName = this.SHIFT_MAPPING[shift];
        if (!shiftName) {
            throw new Error(`未知的班別對應: ${shift}`);
        }
        
        this.logMessage(`開始選擇班別: ${shiftName}`, 'info');
        
        try {
            // 優先查找原生 select 元素
            const shiftSelect = dialog.querySelector('select[aria-label="班別"]');
            
            if (shiftSelect) {
                // 原生 select 元素的處理方式
                this.logMessage('找到原生 select 元素', 'info');
                
                // 直接設定值
                shiftSelect.value = shift;
                shiftSelect.dispatchEvent(new Event('change', { bubbles: true }));
                
                this.logMessage(`成功選擇班別: ${shiftName}`, 'success');
                await this.sleep(500);
                return;
            }
            
            // 查找班別的 combobox 元素 
            const comboboxes = dialog.querySelectorAll('[role="combobox"]');
            this.logMessage(`找到 ${comboboxes.length} 個 combobox`, 'info');
            
            if (comboboxes.length >= 2) {
                // 第二個 combobox 通常是班別選擇器（第一個是部門）
                const shiftCombobox = comboboxes[1];
                this.logMessage('找到班別 combobox 選擇器', 'info');
                
                // 使用 combobox 專用方法選擇班別
                await this.selectComboboxValue(shiftCombobox, shiftName, '班別');
                return;
            } else {
                throw new Error(`combobox 數量不足，預期至少2個，實際找到 ${comboboxes.length} 個`);
            }
            
            this.logMessage(`成功選擇班別: ${shiftName}`, 'success');
            await this.sleep(500);
            
        } catch (error) {
            this.logMessage(`選擇班別失敗: ${error.message}`, 'error');
            throw error;
        }
    }
    
    async findAllAvailableOptions() {
        // 使用多種策略查找所有可能的選項
        const selectors = [
            // Angular Material 選項
            'mat-option',
            '.mat-option',
            '[role="option"]',
            'mat-option[role="option"]',
            // 下拉選項
            '.cdk-overlay-pane mat-option',
            '.mat-select-panel mat-option',
            '.mat-select-panel [role="option"]',
            // 一般選項
            'option',
            '[role="listbox"] [role="option"]',
            '[role="listbox"] option',
            // 通用可點擊項目
            '.mat-option-text',
            '[data-option]',
            '.option-item'
        ];
        
        let allOptions = [];
        
        for (const selector of selectors) {
            try {
                const options = document.querySelectorAll(selector);
                if (options.length > 0) {
                    this.logMessage(`選擇器 "${selector}" 找到 ${options.length} 個選項`, 'info');
                    // 合併所有找到的選項，避免重複
                    for (const option of options) {
                        if (!allOptions.includes(option) && option.offsetParent !== null) { // 只要可見的
                            allOptions.push(option);
                        }
                    }
                }
            } catch (error) {
                // 跳過無效的選擇器
                continue;
            }
            await this.sleep(100);
        }
        
        this.logMessage(`總共找到 ${allOptions.length} 個去重後的選項`, 'info');
        return allOptions;
    }
    
    async selectOptionFromList(options, targetText) {
        this.logMessage(`在 ${options.length} 個選項中查找: "${targetText}"`, 'info');
        
        // 記錄所有選項用於調試
        const optionTexts = options.map((opt, index) => `${index}: "${opt.textContent?.trim() || '[空白]'}"`);
        this.logMessage(`所有選項: ${optionTexts.join(', ')}`, 'info');
        
        // 首先嘗試精確匹配
        for (const option of options) {
            const optionText = option.textContent?.trim() || '';
            if (optionText === targetText) {
                this.logMessage(`精確匹配: "${optionText}"`, 'info');
                option.click();
                await this.sleep(500);
                return true;
            }
        }
        
        // 然後嘗試包含匹配
        for (const option of options) {
            const optionText = option.textContent?.trim() || '';
            if (optionText.includes(targetText) || targetText.includes(optionText)) {
                this.logMessage(`包含匹配: "${optionText}"`, 'info');
                option.click();
                await this.sleep(500);
                return true;
            }
        }
        
        this.logMessage(`沒有找到匹配的選項: "${targetText}"`, 'warning');
        return false;
    }
    
    
    async setCheckOutTime(dialog, timeSettings, isOvernight) {
        this.logMessage(`設定簽退時間: ${timeSettings.hour}:${timeSettings.minute} (跨夜: ${isOvernight})`, 'info');
        
        try {
            // 如果是跨夜班別，需要先設定簽退日期
            if (isOvernight) {
                await this.setCheckOutDate(dialog);
                await this.sleep(500);
            }
            
            // 查找簽退時間的 mat-select 元素
            const allMatSelects = dialog.querySelectorAll('mat-select[name="HourStart"], mat-select[name="MinuteStart"]');
            this.logMessage(`找到 ${allMatSelects.length} 個時間相關的 mat-select 元素`, 'info');
            
            // 記錄所有時間相關元素的信息
            for (let i = 0; i < allMatSelects.length; i++) {
                const element = allMatSelects[i];
                const id = element.id || 'no-id';
                const name = element.getAttribute('name') || 'no-name';
                this.logMessage(`時間選擇器 ${i}: id=${id}, name=${name}`, 'info');
            }
            
            if (allMatSelects.length >= 4) {
                // 假設後兩個是簽退時間：簽退小時、簽退分鐘
                const hourSelect = allMatSelects[2];  // 第3個是簽退小時
                const minuteSelect = allMatSelects[3]; // 第4個是簽退分鐘
                
                this.logMessage(`使用第3、4個時間選擇器作為簽退時間 (${hourSelect.id}, ${minuteSelect.id})`, 'info');
                
                // 設定簽退小時
                await this.selectMatSelectValue(hourSelect, timeSettings.hour, '簽退小時');
                await this.sleep(500);
                
                // 設定簽退分鐘
                await this.selectMatSelectValue(minuteSelect, timeSettings.minute, '簽退分鐘');
            } else {
                throw new Error(`時間相關的 mat-select 數量不足，預期至少4個，實際 ${allMatSelects.length} 個`);
            }
            
        } catch (error) {
            this.logMessage(`設定簽退時間失敗: ${error.message}`, 'error');
            throw error;
        }
    }
    
    async selectComboboxValue(combobox, value, fieldName) {
        this.logMessage(`${fieldName}: 設定 combobox 值為 "${value}"`, 'info');
        
        try {
            // 獲取當前值
            const currentValueElement = combobox.querySelector('generic');
            const currentValue = currentValueElement?.textContent?.trim() || '';
            this.logMessage(`${fieldName}: 當前值為 "${currentValue}"`, 'info');
            
            // 確保目標值格式正確（兩位數字）
            const paddedValue = String(value).padStart(2, '0');
            
            // 如枟當前值已經是目標值，跳過
            if (currentValue === paddedValue || currentValue === String(parseInt(value))) {
                this.logMessage(`${fieldName}: 值已經是 "${value}"，跳過設定`, 'info');
                return;
            }
            
            // 點擊打開下拉選單
            this.logMessage(`${fieldName}: 點擊打開 combobox`, 'info');
            combobox.click();
            
            // 等待選項出現
            await this.sleep(1000);
            
            // 查找 option 選項（用一般的 option 標籤）
            const options = document.querySelectorAll('option');
            this.logMessage(`${fieldName}: 找到 ${options.length} 個 option`, 'info');
            
            // 尋找並點擊目標值，支援多種格式匹配
            let found = false;
            const searchValues = [paddedValue, String(parseInt(value)), value];
            
            for (const option of options) {
                const optionText = option.textContent?.trim() || '';
                
                // 嘗試匹配多種格式
                if (searchValues.includes(optionText)) {
                    this.logMessage(`${fieldName}: 找到並點擊選項 "${optionText}"`, 'info');
                    option.click();
                    found = true;
                    break;
                }
            }
            
            if (!found) {
                // 列出所有可用選項供調試
                const availableOptions = Array.from(options).map(opt => 
                    opt.textContent?.trim() || ''
                ).filter(text => text).join(', ');
                throw new Error(`${fieldName}: 找不到值 "${value}" (嘗試: ${searchValues.join(', ')})。可用選項: [${availableOptions}]`);
            }
            
            this.logMessage(`${fieldName}: 成功設定為 "${paddedValue}"`, 'success');
            await this.sleep(500);
            
        } catch (error) {
            this.logMessage(`${fieldName}: 設定失敗: ${error.message}`, 'error');
            throw error;
        }
    }
    
    async selectMatSelectValue(matSelect, value, fieldName) {
        this.logMessage(`${fieldName}: 設定 mat-select 值為 "${value}"`, 'info');
        
        try {
            // 獲取當前值（根據實際HTML結構）
            let currentValue = '';
            const valueSelectors = [
                '.mat-mdc-select-min-line',        // 實際的值元素
                '.mat-mdc-select-value-text',      // 值文字容器
                '.mat-select-value-text',          // 舊版選擇器
                '.mat-select-placeholder',         // 佔位符
                '.mat-select-value'                // 值容器
            ];
            
            for (const selector of valueSelectors) {
                const valueElement = matSelect.querySelector(selector);
                if (valueElement && valueElement.textContent?.trim()) {
                    currentValue = valueElement.textContent.trim();
                    break;
                }
            }
            
            this.logMessage(`${fieldName}: 當前值為 "${currentValue}"`, 'info');
            
            // 確保目標值格式正確（兩位數字）
            const paddedValue = String(value).padStart(2, '0');
            
            // 如果當前值已經是目標值，跳過
            if (currentValue === paddedValue || currentValue === String(parseInt(value))) {
                this.logMessage(`${fieldName}: 值已經是 "${value}"，跳過設定`, 'info');
                return;
            }
            
            // 點擊打開 mat-select 下拉選單
            this.logMessage(`${fieldName}: 點擊打開 mat-select`, 'info');
            
            // 嘗試點擊觸發器區域
            const trigger = matSelect.querySelector('.mat-mdc-select-trigger');
            if (trigger) {
                this.logMessage(`${fieldName}: 點擊 mat-select 觸發器`, 'info');
                trigger.click();
            } else {
                this.logMessage(`${fieldName}: 點擊整個 mat-select 元素`, 'info');
                matSelect.click();
            }
            
            // 等待選項面板出現，嘗試多次
            let matOptions = [];
            let attempts = 0;
            const maxAttempts = 10;
            
            while (attempts < maxAttempts && matOptions.length === 0) {
                await this.sleep(200);
                
                // 嘗試多種選擇器查找選項
                const optionSelectors = [
                    'mat-option',
                    '.mat-option',
                    '[role="option"]',
                    '.cdk-overlay-pane mat-option',
                    '.mat-select-panel mat-option'
                ];
                
                for (const selector of optionSelectors) {
                    const options = document.querySelectorAll(selector);
                    if (options.length > 0) {
                        matOptions = Array.from(options);
                        this.logMessage(`${fieldName}: 使用選擇器 "${selector}" 找到 ${options.length} 個選項`, 'info');
                        break;
                    }
                }
                
                attempts++;
            }
            
            this.logMessage(`${fieldName}: 最終找到 ${matOptions.length} 個選項`, 'info');
            
            // 尋找並點擊目標值，支援多種格式匹配
            let found = false;
            const searchValues = [paddedValue, String(parseInt(value)), value];
            
            for (const option of matOptions) {
                const optionText = option.textContent?.trim() || '';
                
                // 嘗試匹配多種格式
                if (searchValues.includes(optionText)) {
                    this.logMessage(`${fieldName}: 找到並點擊 mat-option "${optionText}"`, 'info');
                    option.click();
                    found = true;
                    break;
                }
            }
            
            if (!found) {
                // 列出所有可用選項供調試
                const availableOptions = Array.from(matOptions).map(opt => 
                    opt.textContent?.trim() || ''
                ).filter(text => text).join(', ');
                throw new Error(`${fieldName}: 找不到值 "${value}" (嘗試: ${searchValues.join(', ')})。可用 mat-option: [${availableOptions}]`);
            }
            
            this.logMessage(`${fieldName}: 成功設定為 "${paddedValue}"`, 'success');
            await this.sleep(500);
            
        } catch (error) {
            this.logMessage(`${fieldName}: 設定失敗: ${error.message}`, 'error');
            throw error;
        }
    }
    
    async setCheckOutDate(dialog) {
        // 找到簽退日期的日曆按鈕
        const calendarButtons = dialog.querySelectorAll('button[aria-label*="Open calendar"]');
        
        if (calendarButtons.length >= 2) {
            const checkOutCalendarButton = calendarButtons[1]; // 第二個是簽退日期
            this.logMessage('點擊簽退日期日曆按鈕', 'info');
            checkOutCalendarButton.click();
            await this.sleep(500);
            
            // 等待日曆展開
            await this.sleep(1000);
            
            // 計算隔日日期 - 從簽到日期輸入框獲取工作日期
            const checkinDateInput = dialog.querySelector('textbox[disabled]') || 
                                   dialog.querySelector('input[disabled]');
            
            let workDateText = '';
            if (checkinDateInput) {
                workDateText = checkinDateInput.value || checkinDateInput.textContent || checkinDateInput.innerText || '';
                this.logMessage(`從簽到日期獲取工作日期: "${workDateText}"`, 'info');
            }
            
            // 如果還是沒找到，從工作日顯示區域獲取
            if (!workDateText) {
                const workDayElements = dialog.querySelectorAll('generic');
                for (const elem of workDayElements) {
                    const text = elem.textContent || '';
                    if (text.match(/^\d{4}-\d{2}-\d{2}$/)) {
                        workDateText = text.replace(/-/g, '/');
                        this.logMessage(`從工作日顯示區域獲取日期: "${workDateText}"`, 'info');
                        break;
                    }
                }
            }
            
            let workDate;
            if (workDateText && workDateText.includes('/')) {
                // 解析工作日期，格式如 "2025/08/02"
                const dateParts = workDateText.split('/');
                workDate = new Date(parseInt(dateParts[0]), parseInt(dateParts[1]) - 1, parseInt(dateParts[2]));
                this.logMessage(`解析工作日期: ${workDateText} -> ${workDate.toDateString()}`, 'info');
            } else {
                // 備用方案：使用當前日期
                workDate = new Date();
                this.logMessage(`無法解析工作日期 (得到: "${workDateText}")，使用當前日期: ${workDate.toDateString()}`, 'warning');
            }
            
            const tomorrow = new Date(workDate);
            tomorrow.setDate(tomorrow.getDate() + 1);
            this.logMessage(`計算隔日: ${workDate.toDateString()} -> ${tomorrow.toDateString()}`, 'info');
            
            const targetYear = tomorrow.getFullYear();
            const targetMonth = tomorrow.getMonth() + 1; // JavaScript month is 0-based
            const targetDate = tomorrow.getDate();
            
            // 構建目標日期字符串，格式如 "2025/08/02"
            const targetDateStr = `${targetYear}/${String(targetMonth).padStart(2, '0')}/${String(targetDate).padStart(2, '0')}`;
            
            this.logMessage(`尋找隔日日期: ${targetDateStr}`, 'info');
            
            // 檢查是否需要導航到下個月（當隔日是下個月第一天時）
            const workMonth = workDate.getMonth();
            const targetMonthIndex = tomorrow.getMonth();
            
            if (targetMonthIndex !== workMonth) {
                this.logMessage(`隔日在下個月，需要導航到 ${targetYear}/${String(targetMonthIndex + 1).padStart(2, '0')}`, 'info');
                
                // 查找並點擊"下個月"按鈕
                const nextMonthBtn = document.querySelector('button[aria-label*="Next month"], .mat-calendar-next-button') ||
                                   document.querySelector('button[title*="Next"], button[title*="下個月"]');
                if (nextMonthBtn) {
                    this.logMessage('點擊下個月按鈕', 'info');
                    nextMonthBtn.click();
                    await this.sleep(1000); // 等待日曆更新
                } else {
                    this.logMessage('找不到下個月按鈕，嘗試其他選擇器', 'warning');
                    // 嘗試其他可能的選擇器
                    const possibleNextBtns = document.querySelectorAll('button');
                    for (const btn of possibleNextBtns) {
                        const btnText = (btn.textContent || '').toLowerCase();
                        const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
                        const title = (btn.getAttribute('title') || '').toLowerCase();
                        
                        if (btnText.includes('next') || ariaLabel.includes('next') || title.includes('next') ||
                            btnText.includes('下') || ariaLabel.includes('下') || 
                            btn.querySelector('mat-icon, [class*="arrow"], [class*="chevron"]')) {
                            this.logMessage(`嘗試點擊可能的下個月按鈕: ${btnText || ariaLabel || title}`, 'info');
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
                this.logMessage(`點擊隔日日期: ${targetDate}`, 'info');
                targetButton.click();
                await this.sleep(500);
            } else {
                throw new Error(`找不到隔日日期按鈕: ${targetDate}`);
            }
        } else {
            throw new Error('找不到簽退日期日曆按鈕');
        }
    }
    
    
    
    async waitForDialogWithValidation(timeout = 5000) {
        const startTime = Date.now();
        
        while (Date.now() - startTime < timeout) {
            // 嘗試多種選擇器找到對話框
            let dialog = document.querySelector('[role="dialog"]');
            if (!dialog) {
                dialog = document.querySelector('.mat-dialog-container');
            }
            if (!dialog) {
                dialog = document.querySelector('.modal-dialog');
            }
            if (!dialog) {
                dialog = document.querySelector('[aria-modal="true"]');
            }
            
            if (dialog) {
                // 驗證對話框是否完整載入
                const hasTitle = dialog.querySelector('h1, h2, h3, .mat-dialog-title, [role="heading"], .modal-title');
                const hasContent = dialog.querySelector('form, .mat-dialog-content, .modal-body, .dialog-content');
                const hasSelects = dialog.querySelectorAll('select, [role="combobox"]').length > 0;
                
                // 至少要有內容和選擇器
                if ((hasTitle || hasContent) && hasSelects) {
                    this.logMessage('對話框已完整載入', 'info');
                    await this.sleep(500); // 額外等待確保完全渲染
                    return dialog;
                }
            }
            await this.sleep(200);
        }
        
        return null;
    }
    
    async waitForDialogCloseWithValidation() {
        let attempts = 0;
        const maxAttempts = 15;
        
        while (attempts < maxAttempts) {
            const dialog = document.querySelector('[role="dialog"]');
            if (!dialog) {
                // 等待一段時間確保操作完成
                await this.sleep(1000);
                return;
            }
            
            await this.sleep(500);
            attempts++;
        }
        
        throw new Error('對話框未在預期時間內關閉');
    }
    
    async ensureDialogClosed() {
        const dialog = document.querySelector('[role="dialog"]');
        if (dialog) {
            // 嘗試點擊取消按鈕關閉對話框
            let cancelButton = dialog.querySelector('button[mat-dialog-close]');
            
            // 如果沒找到，則查找包含"取消"文字的按鈕
            if (!cancelButton) {
                const buttons = dialog.querySelectorAll('button');
                for (const button of buttons) {
                    if (button.textContent && button.textContent.trim().includes('取消')) {
                        cancelButton = button;
                        break;
                    }
                }
            }
            
            if (cancelButton) {
                this.logMessage('點擊取消按鈕關閉對話框', 'info');
                cancelButton.click();
                await this.sleep(1000);
            } else {
                // 嘗試按 ESC 鍵
                this.logMessage('嘗試按 ESC 鍵關閉對話框', 'info');
                document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
                await this.sleep(1000);
            }
        }
    }
    
    async submitForm(dialog) {
        try {
            // 在提交前重新設置對話框攔截器以確保可以處理確認對話框
            this.setupConfirmOverride();
            
            // 確保只在打卡對話框內尋找送出按鈕，避免點擊頁面上方的"送出申請"按鈕
            this.logMessage('在打卡對話框內尋找送出按鈕', 'info');
            
            const buttons = dialog.querySelectorAll('button');
            let submitButton = null;
            
            // 優先查找包含"送出"文字但不包含"申請"的按鈕
            for (const btn of buttons) {
                const buttonText = btn.textContent ? btn.textContent.trim() : '';
                
                // 明確排除"送出申請"按鈕，只要"送出"按鈕
                if (buttonText === '送出') {
                    submitButton = btn;
                    this.logMessage(`找到對話框內的送出按鈕: "${buttonText}"`, 'info');
                    break;
                } else if (buttonText === '確認' || buttonText === '提交' || buttonText === '儲存') {
                    submitButton = btn;
                    this.logMessage(`找到替代提交按鈕: "${buttonText}"`, 'info');
                    break;
                }
            }
            
            if (!submitButton) {
                // 列出所有可用按鈕供調試
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
            
            this.logMessage('點擊對話框內的送出按鈕提交打卡資料...', 'info');
            submitButton.click();
            
            // 等待確認對話框出現並自動處理
            await this.sleep(1000);
            
            // 處理提交後的確認對話框
            await this.handleConfirmationDialog();
            
        } catch (error) {
            this.logMessage(`提交表單失敗: ${error.message}`, 'error');
            throw error;
        }
    }
    
    async handleConfirmationDialog() {
        this.logMessage('處理連續兩個瀏覽器原生確認對話框...', 'info');
        
        // 瀏覽器原生的confirm對話框會自動被處理，因為我們會在頁面加載時設置事件監聽器
        // 只需要等待一下讓確認流程完成
        await this.sleep(3000);
        
        this.logMessage('瀏覽器原生確認對話框處理完成', 'info');
    }
    
    async waitForDialogClose() {
        // 等待對話框關閉
        let attempts = 0;
        const maxAttempts = 10;
        
        while (attempts < maxAttempts) {
            const dialog = document.querySelector('[role="dialog"]');
            if (!dialog) {
                return; // 對話框已關閉
            }
            
            await this.sleep(500);
            attempts++;
        }
        
        throw new Error('對話框未在預期時間內關閉');
    }
    
    async waitForElement(selector, timeout = 5000) {
        const startTime = Date.now();
        
        while (Date.now() - startTime < timeout) {
            const element = document.querySelector(selector);
            if (element) {
                return element;
            }
            await this.sleep(100);
        }
        
        return null;
    }
    
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    
    notifyComplete(success, error = null) {
        this.sendMessageSafely({
            type: 'AUTOFILL_COMPLETE',
            success: success,
            error: error
        });
    }
    
    logMessage(message, type = 'info') {
        console.log(`[彰基自動打卡] ${message}`);
        
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
                    // popup 已關閉或不存在，這是正常情況，不需要記錄
                    // console.log('Popup not available:', chrome.runtime.lastError.message);
                }
            });
        } catch (error) {
            // 忽略通信錯誤，因為這通常發生在 popup 關閉時
            // console.log('Message sending failed:', error.message);
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
    console.log('彰基自動打卡擴充功能已載入');
} else {
    console.log('不在彰基EIP頁面，自動打卡功能暫時停用');
}