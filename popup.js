// 彰基醫院自動打卡系統 - 彈出視窗邏輯
// 處理使用者介面互動和排班預覽

class PopupController {
    constructor() {
        this.currentYear = new Date().getFullYear();
        this.currentMonth = new Date().getMonth();
        this.onCallDays = new Set();
        this.leaveDays = new Set();
        this.overtimeDays = new Set();
        this.isExecuting = false;
        this.currentMode = 'oncall'; // 預設模式
        
        this.initializeElements();
        this.initializeEventListeners();
        this.renderCalendar();
        this.updateButtonState(); // 初始化延長工時顯示
        this.checkCurrentPage();
    }
    
    initializeElements() {
        // 月份控制
        this.prevMonthBtn = document.getElementById('prevMonth');
        this.nextMonthBtn = document.getElementById('nextMonth');
        this.currentMonthLabel = document.getElementById('currentMonth');
        
        // 模式選擇器
        this.onCallModeBtn = document.getElementById('onCallMode');
        this.leaveModeBtn = document.getElementById('leaveMode');
        this.overtimeModeBtn = document.getElementById('overtimeMode');
        
        // 統一日曆容器
        this.unifiedCalendar = document.getElementById('unifiedCalendar');
        
        // 延長工時顯示
        this.totalOvertimeHours = document.getElementById('totalOvertimeHours');
        
        // 控制按鈕
        this.clearAllBtn = document.getElementById('clearAll');
        this.startAutofillBtn = document.getElementById('startAutofill');
        
        // 進度顯示
        this.progressSection = document.getElementById('progressSection');
        this.progressFill = document.getElementById('progressFill');
        this.progressLog = document.getElementById('progressLog');
        this.stopProcessBtn = document.getElementById('stopProcess');
    }
    
    initializeEventListeners() {
        // 月份切換
        this.prevMonthBtn.addEventListener('click', () => this.changeMonth(-1));
        this.nextMonthBtn.addEventListener('click', () => this.changeMonth(1));
        
        // 模式切換
        this.onCallModeBtn.addEventListener('click', () => this.switchMode('oncall'));
        this.leaveModeBtn.addEventListener('click', () => this.switchMode('leave'));
        this.overtimeModeBtn.addEventListener('click', () => this.switchMode('overtime'));
        
        // 控制按鈕
        this.clearAllBtn.addEventListener('click', () => this.clearAllSelections());
        this.startAutofillBtn.addEventListener('click', () => this.startAutofill());
        this.stopProcessBtn.addEventListener('click', () => this.stopProcess());
        
        // 監聽來自 content script 的訊息
        this.setupContentScriptListener();
    }
    
    setupContentScriptListener() {
        // 檢查是否在 Chrome extension 環境中
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
            chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
                switch (message.type) {
                    case 'LOG_MESSAGE':
                        this.filterAndLogMessage(message.message, message.messageType);
                        break;
                    case 'UPDATE_PROGRESS':
                        this.updateProgress(message.current, message.total);
                        break;
                    case 'AUTOFILL_COMPLETE':
                        this.handleAutofillComplete(message);
                        break;
                }
                return true;
            });
        }
    }
    
    filterAndLogMessage(message, messageType) {
        // 只顯示用戶關心的重要訊息
        const importantKeywords = [
            '開始自動打卡',
            '共需處理',
            '號打卡完成',
            '所有打卡記錄處理完成',
            '自動打卡完成',
            '自動打卡失敗',
            '用戶取消執行',
            '錯誤:',
            '指令已發送到頁面',
            '自動打卡系統已停止運行'
        ];
        
        // 檢查訊息是否包含重要關鍵詞
        const shouldShow = importantKeywords.some(keyword => 
            message.includes(keyword)
        );
        
        if (shouldShow) {
            this.logMessage(message, messageType);
        }
    }
    
    handleAutofillComplete(message) {
        this.isExecuting = false;
        this.stopProcessBtn.style.display = 'none';
        this.startAutofillBtn.disabled = false;
        this.clearAllBtn.disabled = false;
        
        if (message.success) {
            this.logMessage('自動打卡完成！', 'success');
        } else {
            this.logMessage(`自動打卡失敗: ${message.error}`, 'error');
        }
    }
    
    changeMonth(delta) {
        this.currentMonth += delta;
        if (this.currentMonth < 0) {
            this.currentMonth = 11;
            this.currentYear--;
        } else if (this.currentMonth > 11) {
            this.currentMonth = 0;
            this.currentYear++;
        }
        
        // 清除當前選擇（因為切換月份了）
        this.onCallDays.clear();
        this.leaveDays.clear();
        this.overtimeDays.clear();
        
        this.renderCalendar();
        this.updateButtonState(); // 這裡會同時更新延長工時顯示
    }
    
    renderCalendar() {
        // 更新月份標籤
        this.currentMonthLabel.textContent = `${this.currentYear}年${this.currentMonth + 1}月`;
        
        // 渲染統一日曆
        this.renderUnifiedCalendar();
    }
    
    switchMode(mode) {
        this.currentMode = mode;
        
        // 更新按鈕狀態
        document.querySelectorAll('.mode-btn').forEach(btn => btn.classList.remove('active'));
        document.querySelector(`[data-mode="${mode}"]`).classList.add('active');
        
        // 為加班模式添加特殊CSS類
        const calendarContainer = document.querySelector('.calendar-container');
        if (mode === 'overtime') {
            calendarContainer.classList.add('overtime-mode');
        } else {
            calendarContainer.classList.remove('overtime-mode');
        }
        
        // 重新渲染日曆以更新可選狀態
        this.renderCalendar();
    }
    
    renderUnifiedCalendar() {
        const container = this.unifiedCalendar;
        container.innerHTML = '';
        
        // 建立日曆標題行
        const header = document.createElement('div');
        header.className = 'calendar-header';
        
        WEEKDAYS_SHORT.forEach(day => {
            const dayHeader = document.createElement('div');
            dayHeader.className = 'day-header';
            dayHeader.textContent = day;
            header.appendChild(dayHeader);
        });
        
        container.appendChild(header);
        
        // 建立日曆主體
        const body = document.createElement('div');
        body.className = 'calendar-body';
        
        const days = DateUtils.getDaysInMonth(this.currentYear, this.currentMonth);
        
        days.forEach(dayInfo => {
            const dayCell = document.createElement('div');
            dayCell.className = 'day-cell';
            dayCell.textContent = dayInfo.date;
            
            // 設定樣式類別
            if (!dayInfo.isCurrentMonth) {
                dayCell.classList.add('other-month');
            } else {
                const dateStr = DateUtils.formatDate(dayInfo.year, dayInfo.month, dayInfo.date);
                const isWeekend = DateUtils.isWeekend(dayInfo.year, dayInfo.month, dayInfo.date);
                const isToday = DateUtils.isToday(dayInfo.year, dayInfo.month, dayInfo.date);
                const isFuture = this.isFutureDate(dayInfo.year, dayInfo.month, dayInfo.date);
                const dayOfWeek = DateUtils.getDayOfWeek(dayInfo.year, dayInfo.month, dayInfo.date);
                
                if (isWeekend) dayCell.classList.add('weekend');
                if (isToday) dayCell.classList.add('today');
                
                // 檢查是否為今天或未來日期
                if (isToday || isFuture) {
                    dayCell.classList.add('future-date');
                    // 如果已選擇的日期是今天或未來，清除選擇
                    this.onCallDays.delete(dateStr);
                    this.leaveDays.delete(dateStr);
                    this.overtimeDays.delete(dateStr);
                } else {
                    // 檢查是否可選擇（根據當前模式）
                    let canSelect = true;
                    let disableReason = '';
                    
                    if (this.currentMode === 'overtime') {
                        // 加班模式限制
                        if (dayOfWeek === 0 || dayOfWeek === 6) {
                            // 週末不能選加班
                            canSelect = false;
                            disableReason = '週末不可選擇加班';
                        } else {
                            // 檢查是否為值班隔天
                            const yesterday = new Date(dayInfo.year, dayInfo.month, dayInfo.date - 1);
                            const yesterdayStr = DateUtils.formatDate(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate());
                            if (this.onCallDays.has(yesterdayStr)) {
                                canSelect = false;
                                disableReason = '值班隔天不可選擇加班';
                            }
                        }
                    }
                    
                    if (!canSelect) {
                        dayCell.classList.add('disabled-for-overtime');
                        dayCell.title = disableReason;
                    } else {
                        // 重置樣式（當模式切換時）
                        dayCell.classList.remove('disabled-for-overtime');
                        dayCell.title = '';
                    }
                    
                    // 顯示選中狀態
                    if (this.onCallDays.has(dateStr)) {
                        dayCell.classList.add('selected-oncall');
                    }
                    if (this.leaveDays.has(dateStr)) {
                        dayCell.classList.add('selected-leave');
                    }
                    if (this.overtimeDays.has(dateStr)) {
                        dayCell.classList.add('selected-overtime');
                    }
                    
                    // 只對過去日期且可選擇的日期添加點擊事件
                    if (canSelect) {
                        dayCell.addEventListener('click', () => {
                            this.toggleDateSelection(dateStr, dayCell);
                        });
                    }
                }
            }
            
            body.appendChild(dayCell);
        });
        
        container.appendChild(body);
    }
    
    toggleDateSelection(dateStr, cellElement) {
        const currentMode = this.currentMode;
        
        if (currentMode === 'oncall') {
            // 如果已經被選為其他類型，先移除
            this.leaveDays.delete(dateStr);
            this.overtimeDays.delete(dateStr);
            
            // 切換值班日選擇
            if (this.onCallDays.has(dateStr)) {
                this.onCallDays.delete(dateStr);
            } else {
                this.onCallDays.add(dateStr);
                
                // 檢查隔天是否有加班日，如果有則移除
                const [year, month, day] = dateStr.split('/').map(Number);
                const tomorrow = new Date(year, month - 1, day + 1);
                const tomorrowStr = DateUtils.formatDate(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate());
                if (this.overtimeDays.has(tomorrowStr)) {
                    this.overtimeDays.delete(tomorrowStr);
                }
            }
        } else if (currentMode === 'leave') {
            // 如果已經被選為其他類型，先移除
            this.onCallDays.delete(dateStr);
            this.overtimeDays.delete(dateStr);
            
            // 切換請假日選擇
            if (this.leaveDays.has(dateStr)) {
                this.leaveDays.delete(dateStr);
            } else {
                this.leaveDays.add(dateStr);
            }
        } else if (currentMode === 'overtime') {
            // 加班日只能選擇週一到週五
            const [year, month, day] = dateStr.split('/').map(Number);
            const dayOfWeek = DateUtils.getDayOfWeek(year, month - 1, day);
            
            if (dayOfWeek === 0 || dayOfWeek === 6) {
                // 週末不能選擇加班
                return;
            }
            
            // 檢查是否為值班隔天
            const yesterday = new Date(year, month - 1, day - 1);
            const yesterdayStr = DateUtils.formatDate(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate());
            if (this.onCallDays.has(yesterdayStr)) {
                // 值班隔天不能選擇加班
                return;
            }
            
            // 如果已經被選為其他類型，先移除
            this.onCallDays.delete(dateStr);
            this.leaveDays.delete(dateStr);
            
            // 切換加班日選擇
            if (this.overtimeDays.has(dateStr)) {
                this.overtimeDays.delete(dateStr);
            } else {
                this.overtimeDays.add(dateStr);
            }
        }
        
        // 重新渲染日曆以更新狀態
        this.renderCalendar();
        
        // 檢查是否有選擇日期來啟用/禁用按鈕
        this.updateButtonState();
    }
    
    clearAllSelections() {
        this.onCallDays.clear();
        this.leaveDays.clear();
        this.overtimeDays.clear();
        this.renderCalendar();
        this.updateButtonState(); // 這裡會同時更新延長工時顯示
    }
    
    updateButtonState() {
        // 只有在有選擇日期時才啟用按鈕
        this.startAutofillBtn.disabled = (this.onCallDays.size === 0 && this.leaveDays.size === 0 && this.overtimeDays.size === 0);
        
        // 更新延長工時顯示
        this.updateOvertimeHours();
    }
    
    updateOvertimeHours() {
        // 計算延長工時：值班日3小時，加班日2小時
        const onCallHours = this.onCallDays.size * 3;
        const overtimeHours = this.overtimeDays.size * 2;
        const totalHours = onCallHours + overtimeHours;
        
        // 更新顯示
        this.totalOvertimeHours.textContent = totalHours;
    }
    
    
    async checkCurrentPage() {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            const isCorrectPage = tab.url && tab.url.includes('dpt.cch.org.tw/EIP');
            
            if (!isCorrectPage) {
                this.showWarning('非彰基打卡頁面');
                this.startAutofillBtn.disabled = true;
            }
        } catch (error) {
            // 頁面檢查失敗，靜默處理
        }
    }
    
    showWarning(message) {
        const warning = document.createElement('div');
        warning.style.cssText = `
            background: #fff3cd;
            border: 1px solid #ffeaa7;
            color: #856404;
            padding: 10px;
            border-radius: 4px;
            margin-bottom: 10px;
            font-size: 13px;
            text-align: center;
        `;
        warning.textContent = message;
        
        document.querySelector('main').insertBefore(warning, document.querySelector('.month-selector'));
    }
    
    async startAutofill() {
        if (this.isExecuting) return;
        
        this.isExecuting = true;
        this.stopProcessBtn.style.display = 'block';
        this.startAutofillBtn.disabled = true;
        this.clearAllBtn.disabled = true;
        
        try {
            // 檢查當前分頁
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            
            if (!tab.url.includes('dpt.cch.org.tw/EIP')) {
                this.logMessage('錯誤: 請先導航到彰基EIP網站', 'error');
                return;
            }
            
            if (!tab.url.includes('/Main/Resident/MonthSettlement')) {
                this.logMessage('錯誤: 請導航到月結算頁面', 'error');
                return;
            }
            
            // 生成執行計畫
            const schedule = ScheduleGenerator.generateSchedule(
                this.currentYear, 
                this.currentMonth, 
                this.onCallDays, 
                this.leaveDays,
                this.overtimeDays
            );
            
            const workDays = schedule.filter(day => day.shift && day.times);
            this.logMessage('開始自動打卡...', 'info');
            this.logMessage(`共需處理 ${workDays.length} 天`, 'info');
            
            // 直接透過postMessage發送給content script
            await chrome.tabs.sendMessage(tab.id, {
                type: 'START_AUTOFILL',
                data: workDays
            });
            
            this.logMessage('指令已發送到頁面', 'info');
            
        } catch (error) {
            this.logMessage(`錯誤: ${error.message}`, 'error');
            this.isExecuting = false;
            this.stopProcessBtn.style.display = 'none';
            this.startAutofillBtn.disabled = false;
            this.clearAllBtn.disabled = false;
        }
    }
    
    
    stopProcess() {
        this.isExecuting = false;
        this.stopProcessBtn.style.display = 'none';
        this.startAutofillBtn.disabled = false;
        this.clearAllBtn.disabled = false;
        this.logMessage('用戶取消執行', 'info');
    }
    
    logMessage(message, type = 'info') {
        const entry = document.createElement('div');
        entry.className = `log-entry ${type}`;
        entry.textContent = `${new Date().toLocaleTimeString()} - ${message}`;
        
        this.progressLog.appendChild(entry);
        this.progressLog.scrollTop = this.progressLog.scrollHeight;
    }
    
    updateProgress(current, total) {
        const percentage = Math.round((current / total) * 100);
        this.progressFill.style.width = `${percentage}%`;
    }
    
    
    isFutureDate(year, month, date) {
        const targetDate = new Date(year, month, date);
        const today = new Date();
        today.setHours(0, 0, 0, 0); // 設定為當天的00:00:00
        targetDate.setHours(0, 0, 0, 0);
        return targetDate >= today; // 今天或未來的日期都返回 true
    }
}

// 初始化彈出視窗
document.addEventListener('DOMContentLoaded', () => {
    new PopupController();
});