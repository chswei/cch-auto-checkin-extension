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
        this.currentMode = null; // 'autofill' 或 'remove'
        this.removeData = null; // 存儲移除紀錄的參數
        
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
            } else if (message.type === 'START_REMOVE_RECORDS') {
                this.startRemoveRecords(message.data);
                sendResponse({ status: 'started' });
            } else if (message.type === 'STOP_AUTOFILL') {
                this.stopAutofill();
                sendResponse({ status: 'stopped' });
            } else if (message.type === 'RESUME_AUTOFILL') {
                this.resumeAutofill();
                sendResponse({ status: 'resumed' });
            }
            return true;
        });
    }
    
    async startRemoveRecords(data) {
        const { startDay, endDay } = data;
        this.isRunning = true;
        this.userStopped = false;
        this.currentIndex = 0;
        this.currentMode = 'remove';
        this.removeData = data;
        
        try {
            // 初始延遲，確保頁面穩定
            await this.sleep(1000);
            
            for (let day = startDay; day <= endDay && this.checkRunning(); day++) {
                this.currentIndex = day;
                
                try {
                    await this.removeSingleDayRecord(day);
                    // 只有在成功處理完單日後才更新進度
                    if (this.checkRunning()) {
                        this.updateProgress(day, endDay);
                    }
                } catch (error) {
                    if (!this.checkRunning()) return;
                    this.logMessage(`處理第 ${day} 天時發生錯誤: ${error.message}`, 'warning');
                }
                
                if (day < endDay && this.checkRunning()) {
                    await this.sleep(500);
                }
            }
            
            // 檢查是否正常完成（沒有被用戶停止）
            if (this.checkRunning()) {
                this.notifyComplete(true, null, true);  // 第三個參數表示是刪除操作
                this.logMessage('所有打卡紀錄已移除！', 'success');
            }
            
        } catch (error) {
            if (this.userStopped) {
                // 用戶停止，不當作錯誤處理
                return;
            }
            // 執行過程發生錯誤
            this.notifyComplete(false, error.message);
        } finally {
            if (!this.userStopped) {
                // 只有在正常完成時才重置
                this.isRunning = false;
            }
        }
    }
    
    async removeSingleDayRecord(date) {
        for (let retryCount = 0; retryCount < this.maxRetries; retryCount++) {
            if (!this.checkRunning()) return;
            
            try {
                const editButton = await this.findEditButtonByDate(date);
                if (!editButton) {
                    if (!this.checkRunning()) return;
                    throw new Error(`找不到 ${date} 號的編輯按鈕`);
                }
                
                if (!this.checkRunning()) return;
                
                editButton.click();
                
                // 等待對話框完全載入
                await this.sleep(1000);
                
                const dialog = await this.waitForDialogWithValidation(5000);
                if (!dialog) {
                    if (!this.checkRunning()) return;
                    throw new Error('打卡對話框未出現或驗證失敗');
                }
                
                if (!this.checkRunning()) return;
                
                // 尋找並點擊刪除按鈕
                await this.clickDeleteButton(dialog);
                
                if (!this.checkRunning()) return;
                
                await this.waitForDialogCloseWithValidation();
                
                return; // 成功完成
                
            } catch (error) {
                if (!this.checkRunning()) return;
                
                this.logMessage(`處理 ${date} 號時發生錯誤: ${error.message}（正在自動重試...）`, 'warning');
                
                if (retryCount < this.maxRetries - 1) {
                    await this.sleep(this.retryDelay);
                    await this.ensureDialogClosed();
                } else {
                    if (!this.checkRunning()) return;
                    throw new Error(`處理 ${date} 號失敗，已重試 ${this.maxRetries} 次: ${error.message}`);
                }
            }
        }
    }
    
    async clickDeleteButton(dialog) {
        // 尋找垃圾桶（刪除）按鈕
        let deleteButton = null;
        
        // 方法1：找包含 mat-icon 的按鈕，且 mat-icon 的 title 包含「移除」
        const iconButtons = dialog.querySelectorAll('button:has(mat-icon)');
        for (const btn of iconButtons) {
            const icon = btn.querySelector('mat-icon');
            if (icon && (icon.title?.includes('移除') || icon.title?.includes('刪除'))) {
                deleteButton = btn;
                break;
            }
        }
        
        // 方法2：如果沒找到，嘗試找所有包含 mat-icon 的按鈕中的第二個（通常第一個是編輯，第二個是刪除）
        if (!deleteButton) {
            const buttons = dialog.querySelectorAll('button:has(mat-icon)');
            if (buttons.length >= 2) {
                deleteButton = buttons[1]; // 第二個按鈕
            }
        }
        
        // 方法3：如果還是沒找到，找所有 mat-icon 按鈕並檢查父元素
        if (!deleteButton) {
            const icons = dialog.querySelectorAll('mat-icon');
            for (const icon of icons) {
                const button = icon.closest('button');
                if (button && icon.textContent?.includes('delete')) {
                    deleteButton = button;
                    break;
                }
            }
        }
        
        if (deleteButton) {
            // 檢查按鈕是否可點擊（有紀錄才能刪除）
            if (!deleteButton.disabled) {
                deleteButton.click();
                await this.sleep(100); // dialog-override.js 會自動處理確認對話框
                this.logMessage(`成功刪除第 ${this.currentIndex} 天的打卡紀錄`, 'info');
            } else {
                this.logMessage(`第 ${this.currentIndex} 天無打卡紀錄，跳過`, 'info');
            }
        } else {
            this.logMessage(`第 ${this.currentIndex} 天找不到刪除按鈕，跳過`, 'info');
        }
        
        // 確保對話框關閉
        await this.ensureDialogClosed();
    }
    
    stopAutofill() {
        if (this.isRunning) {
            this.isRunning = false;
            this.userStopped = true;
            // 立即顯示停止訊息
            this.logMessage('用戶停止執行', 'info');
            this.notifyComplete(false, '用戶停止執行');
        }
    }

    async resumeAutofill() {
        if (this.userStopped) {
            this.isRunning = true;
            this.userStopped = false;
            this.logMessage('恢復執行中...', 'info');
            
            // 先確保對話框被關閉
            await this.ensureDialogClosed();
            await this.sleep(500); // 等待對話框完全關閉
            
            if (this.currentMode === 'autofill' && this.workDays && this.workDays.length > 0) {
                // 先顯示當前進度
                this.updateProgress(this.currentIndex, this.workDays.length);
                this.continueFromCurrentIndex();
            } else if (this.currentMode === 'remove' && this.removeData) {
                // 恢復移除紀錄操作
                this.continueRemoveRecords();
            }
        }
    }

    async continueFromCurrentIndex() {
        try {
            for (let i = this.currentIndex; i < this.workDays.length && this.checkRunning(); i++) {
                this.currentIndex = i;
                const workDay = this.workDays[i];
                
                try {
                    await this.processSingleDay(workDay);
                    // 只有在成功處理完單日後才更新進度
                    if (this.checkRunning()) {
                        this.updateProgress(i + 1, this.workDays.length);
                    }
                } catch (error) {
                    if (!this.checkRunning()) return;
                }
                
                if (i < this.workDays.length - 1 && this.checkRunning()) {
                    await this.sleep(800);
                }
            }
            
            // 檢查是否正常完成（沒有被用戶停止）
            if (this.checkRunning()) {
                // 所有打卡記錄處理完成
                this.notifyComplete(true);
                this.logMessage('自動打卡完成！', 'success');
            }
            
        } catch (error) {
            if (this.userStopped) {
                // 用戶停止，不當作錯誤處理
                return;
            }
            // 執行過程發生錯誤
            this.notifyComplete(false, error.message);
        } finally {
            if (this.checkRunning()) {
                // 只有在正常完成時才重置
                this.isRunning = false;
                this.userStopped = false;
            }
        }
    }

    async continueRemoveRecords() {
        const { startDay, endDay } = this.removeData;
        
        try {
            // 從當前索引繼續處理移除紀錄
            for (let day = this.currentIndex; day <= endDay && this.checkRunning(); day++) {
                this.currentIndex = day;
                
                try {
                    await this.removeSingleDayRecord(day);
                    // 只有在成功處理完單日後才更新進度
                    if (this.checkRunning()) {
                        this.updateProgress(day, endDay);
                    }
                } catch (error) {
                    if (!this.checkRunning()) return;
                    this.logMessage(`處理第 ${day} 天時發生錯誤: ${error.message}`, 'warning');
                }
                
                if (day < endDay && this.checkRunning()) {
                    await this.sleep(500);
                }
            }
            
            // 檢查是否正常完成（沒有被用戶停止）
            if (this.checkRunning()) {
                this.notifyComplete(true, null, true);  // 第三個參數表示是刪除操作
                this.logMessage('所有打卡紀錄已移除！', 'success');
            }
            
        } catch (error) {
            if (this.userStopped) {
                // 用戶停止，不當作錯誤處理
                return;
            }
            // 執行過程發生錯誤
            this.notifyComplete(false, error.message);
        } finally {
            if (!this.userStopped) {
                // 只有在正常完成時才重置
                this.isRunning = false;
            }
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
        this.currentMode = 'autofill';
        
        try {
            // 初始延遲，確保頁面穩定
            await this.sleep(1000);
            
            for (let i = 0; i < this.workDays.length && this.checkRunning(); i++) {
                this.currentIndex = i;
                const workDay = this.workDays[i];
                
                try {
                    await this.processSingleDay(workDay);
                    // 只有在成功處理完單日後才更新進度
                    if (this.checkRunning()) {
                        this.updateProgress(i + 1, this.workDays.length);
                    }
                } catch (error) {
                    if (!this.checkRunning()) return;
                }
                
                if (i < this.workDays.length - 1 && this.checkRunning()) {
                    await this.sleep(800);
                }
            }
            
            // 檢查是否正常完成（沒有被用戶停止）
            if (this.checkRunning()) {
                // 所有打卡記錄處理完成
                this.notifyComplete(true);
                this.logMessage('自動打卡完成！', 'success');
            }
            
        } catch (error) {
            if (this.userStopped) {
                // 用戶停止，不當作錯誤處理
                return;
            }
            // 執行過程發生錯誤（實際上很少觸發）
            this.notifyComplete(false, error.message);
        } finally {
            // 只在正常完成時重置狀態，停止時保持 userStopped = true
            if (!this.userStopped) {
                this.isRunning = false;
            }
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
                
                // 等待對話框完全載入
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
        try {
            // 智能等待Angular Material表格載入完成
            const tableFound = await this.waitForCondition(() => {
                const matRow = document.querySelector('mat-row');
                return matRow !== null;
            }, 5000, 100);
            
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
        
        // 1. 設定班別（跳過部門選擇，保持預設值）
        await this.selectShift(dialog, workDay.shift);
        
        // 2. 設定簽退時間
        await this.setCheckOutTime(dialog, timeSetting.checkOut, timeSetting.isOvernight);
        
        // 已完成班別設定
    }
    
    async selectShift(dialog, shift) {
        const shiftName = this.SHIFT_MAPPING[shift];
        if (!shiftName) {
            throw new Error(`未知的班別對應: ${shift}`);
        }
        try {
            // 優先查找原生 select 元素
            const shiftSelect = dialog.querySelector('select[aria-label="班別"]');
            
            if (shiftSelect) {
                // 原生 select 元素的處理方式
                
                // 直接設定值
                shiftSelect.value = shift;
                shiftSelect.dispatchEvent(new Event('change', { bubbles: true }));
                
                // 成功選擇班別，等待選擇生效
                await this.sleep(400);
                return;
            }
            
            // 查找班別的 combobox 元素 
            const comboboxes = dialog.querySelectorAll('[role="combobox"]');
            
            if (comboboxes.length >= 2) {
                // 班別選擇器一定是第二個 combobox（第一個是部門）
                const shiftCombobox = comboboxes[1];
                
                // 使用 combobox 專用方法選擇班別
                await this.selectDropdownValue(shiftCombobox, shiftName, '班別', 'combobox');
                
                this.logMessage(`成功選擇班別: ${shiftName}`, 'success');
                await this.sleep(400);
                return;
            } else {
                // combobox 數量不足
                throw new Error(`找不到班別選擇元素。預期至少 2 個 combobox（部門、班別），實際只有 ${comboboxes.length} 個。`);
            }
            
        } catch (error) {
            this.logMessage(`選擇班別失敗: ${error.message}`, 'error');
            throw error;
        }
    }
    
    
    async setCheckOutTime(dialog, timeSettings, isOvernight) {
        try {
            // 如果是跨夜班別，需要先設定簽退日期
            if (isOvernight) {
                await this.setCheckOutDate(dialog);
                await this.sleep(200);
            }
            
            // 查找簽退時間的 mat-select 元素
            const allMatSelects = dialog.querySelectorAll('mat-select[name="HourStart"], mat-select[name="MinuteStart"]');
            
            
            if (allMatSelects.length >= 4) {
                // 假設後兩個是簽退時間：簽退小時、簽退分鐘
                const hourSelect = allMatSelects[2];  // 第3個是簽退小時
                const minuteSelect = allMatSelects[3]; // 第4個是簽退分鐘
                
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
            // 對於時間選擇（數字），確保兩位數格式；對於班別名稱（字串），直接使用
            let searchValues;
            if (fieldName.includes('小時') || fieldName.includes('分鐘')) {
                // 時間選擇：確保兩位數格式 '08'
                const paddedValue = String(value).padStart(2, '0');
                searchValues = [paddedValue];
            } else {
                // 班別名稱：直接使用原值
                searchValues = [value];
            }
            
            // 檢查當前值是否已正確
            const currentValue = this.getCurrentValue(element, type);
            if (searchValues.includes(currentValue)) return;
            
            // 點擊打開下拉選單
            this.clickDropdownTrigger(element, type);
            await this.sleep(300);
            
            // 等待選項出現
            const options = await this.waitForOptions(type);
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
    
    async waitForOptions(type) {
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
        }, 3000, 150);
        
        return appeared ? options : [];
    }
    
    selectOptionByValue(options, searchValues) {
        for (const option of options) {
            const optionText = option.textContent?.trim() || '';
            // 寬鬆匹配：檢查選項文字是否包含搜尋值的關鍵部分
            for (const searchValue of searchValues) {
                // 檢查完全匹配或部分匹配（例如 "DW2" 在 "DW2：平值8-隔日12" 中）
                if (optionText === searchValue || optionText.startsWith(searchValue + '：')) {
                    option.click();
                    return true;
                }
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
            }, 3000, 100);
            
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
                    }, 2000, 100);
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
                        // 對話框已出現，再等待一下確保所有元素載入完成
                        await this.sleep(500);
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
        }, 5000, 50);
        
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
            
            // 等待確認對話框出現並自動處理（dialog-override.js 會立即處理）
            await this.sleep(100);
            
        } catch (error) {
            this.logMessage(`提交表單失敗: ${error.message}`, 'error');
            throw error;
        }
    }
    
    
    
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    
    /**
     * 智能等待 - 等待條件滿足而非固定時間
     * @param {Function} condition - 條件檢查函數，返回 true 表示條件滿足
     * @param {number} timeout - 最大等待時間（毫秒）
     * @param {number} interval - 檢查間隔（毫秒）
     * @returns {Promise<boolean>} 條件是否滿足
     */
    async waitForCondition(condition, timeout = 5000, interval = 100) {
        const startTime = Date.now();
        
        while (Date.now() - startTime < timeout && this.checkRunning()) {
            try {
                if (await condition()) return true;
            } catch {
                // 條件檢查失敗，繼續等待
            }
            await this.sleep(interval);
        }
        
        return false;
    }
    
    
    notifyComplete(success, error = null, isRemoval = false) {
        this.sendMessageSafely({
            type: 'AUTOFILL_COMPLETE',
            success: success,
            error: error,
            isRemoval: isRemoval
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
            chrome.runtime.sendMessage(message, () => {
                // 檢查是否有錯誤
                if (chrome.runtime.lastError) {
                    // popup 已關閉或不存在，這是正常情況
                }
            });
        } catch {
            // 忽略通信錯誤 - popup 可能已關閉
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

