// 彰基醫院自動打卡系統 - 彈出視窗邏輯
// 處理使用者介面互動和排班預覽

class PopupController {
    constructor() {
        this.currentYear = new Date().getFullYear();
        this.currentMonth = new Date().getMonth();
        this.onCallDays = new Set();
        this.leaveDays = new Set();
        this.isExecuting = false;
        
        this.initializeElements();
        this.initializeEventListeners();
        this.renderCalendars();
        this.checkCurrentPage();
    }
    
    initializeElements() {
        // 月份控制
        this.prevMonthBtn = document.getElementById('prevMonth');
        this.nextMonthBtn = document.getElementById('nextMonth');
        this.currentMonthLabel = document.getElementById('currentMonth');
        
        // 日曆容器
        this.onCallCalendar = document.getElementById('onCallCalendar');
        this.leaveCalendar = document.getElementById('leaveCalendar');
        
        // 預覽和控制
        this.schedulePreview = document.getElementById('schedulePreview');
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
        
        // 控制按鈕
        this.clearAllBtn.addEventListener('click', () => this.clearAllSelections());
        this.startAutofillBtn.addEventListener('click', () => this.startAutofill());
        this.stopProcessBtn.addEventListener('click', () => this.stopProcess());
        
        // 監聽來自 content script 的訊息
        this.setupContentScriptListener();
    }
    
    setupContentScriptListener() {
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            switch (message.type) {
                case 'LOG_MESSAGE':
                    this.logMessage(message.message, message.messageType);
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
    
    handleAutofillComplete(message) {
        this.isExecuting = false;
        this.progressSection.style.display = 'none';
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
        
        this.renderCalendars();
        this.updatePreview();
    }
    
    renderCalendars() {
        // 更新月份標籤
        this.currentMonthLabel.textContent = `${this.currentYear}年${this.currentMonth + 1}月`;
        
        // 渲染兩個日曆
        this.renderCalendar(this.onCallCalendar, 'oncall');
        this.renderCalendar(this.leaveCalendar, 'leave');
    }
    
    renderCalendar(container, type) {
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
                
                if (isWeekend) dayCell.classList.add('weekend');
                if (isToday) dayCell.classList.add('today');
                
                // 檢查是否為今天或未來日期
                if (isToday || isFuture) {
                    dayCell.classList.add('future-date');
                    // 如果已選擇的日期是今天或未來，清除選擇
                    this.onCallDays.delete(dateStr);
                    this.leaveDays.delete(dateStr);
                } else {
                    // 檢查選中狀態
                    if (type === 'oncall' && this.onCallDays.has(dateStr)) {
                        dayCell.classList.add('selected-oncall');
                    } else if (type === 'leave' && this.leaveDays.has(dateStr)) {
                        dayCell.classList.add('selected-leave');
                    }
                    
                    // 只對過去日期添加點擊事件
                    dayCell.addEventListener('click', () => {
                        this.toggleDateSelection(dateStr, type, dayCell);
                    });
                }
            }
            
            body.appendChild(dayCell);
        });
        
        container.appendChild(body);
    }
    
    toggleDateSelection(dateStr, type, cellElement) {
        if (type === 'oncall') {
            // 如果已經被選為請假日，先移除
            this.leaveDays.delete(dateStr);
            
            // 切換值班日選擇
            if (this.onCallDays.has(dateStr)) {
                this.onCallDays.delete(dateStr);
                cellElement.classList.remove('selected-oncall');
            } else {
                this.onCallDays.add(dateStr);
                cellElement.classList.add('selected-oncall');
            }
        } else if (type === 'leave') {
            // 如果已經被選為值班日，先移除
            this.onCallDays.delete(dateStr);
            
            // 切換請假日選擇
            if (this.leaveDays.has(dateStr)) {
                this.leaveDays.delete(dateStr);
                cellElement.classList.remove('selected-leave');
            } else {
                this.leaveDays.add(dateStr);
                cellElement.classList.add('selected-leave');
            }
        }
        
        // 重新渲染日曆以更新狀態
        this.renderCalendars();
        this.updatePreview();
    }
    
    clearAllSelections() {
        this.onCallDays.clear();
        this.leaveDays.clear();
        this.renderCalendars();
        this.updatePreview();
    }
    
    updatePreview() {
        if (this.onCallDays.size === 0 && this.leaveDays.size === 0) {
            this.schedulePreview.innerHTML = '請先選擇值班日和請假日';
            this.startAutofillBtn.disabled = true;
            return;
        }
        
        // 生成排班表
        const schedule = ScheduleGenerator.generateSchedule(
            this.currentYear, 
            this.currentMonth, 
            this.onCallDays, 
            this.leaveDays
        );
        
        // 渲染預覽表格
        this.renderSchedulePreview(schedule);
        this.startAutofillBtn.disabled = false;
    }
    
    renderSchedulePreview(schedule) {
        const table = document.createElement('table');
        table.className = 'schedule-table';
        
        // 表格標題
        const thead = document.createElement('thead');
        thead.innerHTML = `
            <tr>
                <th>日期</th>
                <th>星期</th>
                <th>狀態</th>
                <th>班別</th>
                <th>時間</th>
            </tr>
        `;
        table.appendChild(thead);
        
        // 表格內容
        const tbody = document.createElement('tbody');
        
        schedule.forEach(day => {
            const row = document.createElement('tr');
            row.className = `schedule-row ${day.status}`;
            
            const dayOfWeekName = WEEKDAYS[day.dayOfWeek];
            const timeStr = day.times ? 
                `${day.times.start} - ${day.times.end}${day.times.isOvernight ? '(隔日)' : ''}` : 
                '-';
            
            row.innerHTML = `
                <td>${this.currentMonth + 1}/${day.date}</td>
                <td>${dayOfWeekName}</td>
                <td>${day.reason || '-'}</td>
                <td>${day.shiftName || '-'}</td>
                <td>${timeStr}</td>
            `;
            
            tbody.appendChild(row);
        });
        
        table.appendChild(tbody);
        
        // 統計資訊
        const stats = this.generateStats(schedule);
        const statsDiv = document.createElement('div');
        statsDiv.style.marginTop = '10px';
        statsDiv.style.fontSize = '12px';
        statsDiv.style.color = '#666';
        statsDiv.innerHTML = stats;
        
        this.schedulePreview.innerHTML = '';
        this.schedulePreview.appendChild(table);
        this.schedulePreview.appendChild(statsDiv);
    }
    
    generateStats(schedule) {
        const regularDays = schedule.filter(d => d.status === 'regular').length;
        const onCallDays = schedule.filter(d => d.status === 'oncall').length;
        const leaveDays = schedule.filter(d => d.status === 'leave').length;
        const skipDays = schedule.filter(d => d.status === 'skip').length;
        
        return `
            <strong>統計：</strong>
            一般上班 ${regularDays} 天 | 
            值班 ${onCallDays} 天 | 
            請假 ${leaveDays} 天 | 
            跳過 ${skipDays} 天
        `;
    }
    
    async checkCurrentPage() {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            const isCorrectPage = tab.url && tab.url.includes('dpt.cch.org.tw/EIP');
            
            if (!isCorrectPage) {
                this.showWarning('請先導航到彰基EIP打卡頁面');
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
        `;
        warning.textContent = message;
        
        document.querySelector('main').insertBefore(warning, document.querySelector('.month-selector'));
    }
    
    async startAutofill() {
        if (this.isExecuting) return;
        
        this.isExecuting = true;
        this.progressSection.style.display = 'block';
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
                this.leaveDays
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
        }
        
        this.isExecuting = false;
        this.startAutofillBtn.disabled = false;
        this.clearAllBtn.disabled = false;
    }
    
    
    stopProcess() {
        this.isExecuting = false;
        this.progressSection.style.display = 'none';
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