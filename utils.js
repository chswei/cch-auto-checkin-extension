// 彰基醫院自動打卡系統 - 工具函數
// 處理日期計算、排班邏輯和班別規則

/**
 * 日期工具函數
 */
class DateUtils {
    // 取得指定月份的所有日期
    static getDaysInMonth(year, month) {
        const firstDay = new Date(year, month, 1);
        const lastDay = new Date(year, month + 1, 0);
        const daysInMonth = lastDay.getDate();
        const startDay = firstDay.getDay(); // 0=週日, 1=週一, ..., 6=週六
        
        const days = [];
        
        // 前一個月的填充日期
        const prevMonth = month === 0 ? 11 : month - 1;
        const prevYear = month === 0 ? year - 1 : year;
        const prevMonthLastDay = new Date(prevYear, prevMonth + 1, 0).getDate();
        
        for (let i = startDay - 1; i >= 0; i--) {
            days.push({
                date: prevMonthLastDay - i,
                month: prevMonth,
                year: prevYear,
                isCurrentMonth: false
            });
        }
        
        // 當月日期
        for (let day = 1; day <= daysInMonth; day++) {
            days.push({
                date: day,
                month: month,
                year: year,
                isCurrentMonth: true
            });
        }
        
        // 下一個月的填充日期
        const totalCells = 42; // 6週 × 7天
        const nextMonth = month === 11 ? 0 : month + 1;
        const nextYear = month === 11 ? year + 1 : year;
        
        for (let day = 1; days.length < totalCells; day++) {
            days.push({
                date: day,
                month: nextMonth,
                year: nextYear,
                isCurrentMonth: false
            });
        }
        
        return days;
    }
    
    // 取得星期幾 (0=週日, 1=週一, ..., 6=週六)
    static getDayOfWeek(year, month, date) {
        return new Date(year, month, date).getDay();
    }
    
    // 格式化日期為 YYYY/M/D
    static formatDate(year, month, date) {
        return `${year}/${month + 1}/${date}`;
    }
    
    // 檢查是否為今天
    static isToday(year, month, date) {
        const today = new Date();
        return year === today.getFullYear() && month === today.getMonth() && date === today.getDate();
    }
    
    // 檢查是否為週末
    static isWeekend(year, month, date) {
        const dayOfWeek = this.getDayOfWeek(year, month, date);
        return dayOfWeek === 0 || dayOfWeek === 6; // 週日或週六
    }
}

/**
 * 排班規則處理
 */
class ScheduleRules {
    // 班別定義
    static SHIFT_TYPES = {
        C02: { name: 'C02：8-17半(無休)', startTime: '08:00', endTime: '17:30' },
        W02: { name: 'W02：8-12半(無休)', startTime: '08:00', endTime: '12:00' },
        DW2: { name: 'DW2：8-隔12全', startTime: '08:00', endTime: '12:00', isOvernight: true },
        DW6: { name: 'DW6：8-隔12全', startTime: '08:00', endTime: '12:00', isOvernight: true }
    };
    
    // 根據日期和類型決定班別
    static getShiftType(year, month, date, isOnCall = false, isLeave = false) {
        if (isLeave) return null;
        
        const dayOfWeek = DateUtils.getDayOfWeek(year, month, date);
        
        if (isOnCall) return dayOfWeek === 0 ? 'DW6' : 'DW2';
        
        if (dayOfWeek >= 1 && dayOfWeek <= 5) return 'C02';
        if (dayOfWeek === 6) return 'W02';
        return null;
    }
    
    // 檢查是否應該跳過此日期
    static shouldSkipDate(year, month, date, onCallDays, leaveDays) {
        const currentDateStr = DateUtils.formatDate(year, month, date);
        const dayOfWeek = DateUtils.getDayOfWeek(year, month, date);
        
        if (leaveDays.has(currentDateStr)) return true;
        
        // 檢查值班隔日
        const yesterday = new Date(year, month, date - 1);
        const yesterdayStr = DateUtils.formatDate(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate());
        if (onCallDays.has(yesterdayStr)) return true;
        
        // 檢查週日值班前週六
        const tomorrow = new Date(year, month, date + 1);
        const tomorrowStr = DateUtils.formatDate(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate());
        if (dayOfWeek === 6 && tomorrow.getDay() === 0 && onCallDays.has(tomorrowStr)) return true;
        
        return false;
    }
}

/**
 * 排班計畫生成器
 */
class ScheduleGenerator {
    static generateSchedule(year, month, onCallDays, leaveDays, overtimeDays = new Set()) {
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const schedule = [];
        
        for (let date = 1; date <= daysInMonth; date++) {
            const dateStr = DateUtils.formatDate(year, month, date);
            const dayOfWeek = DateUtils.getDayOfWeek(year, month, date);
            
            // 檢查是否為今天或未來日期
            const isToday = DateUtils.isToday(year, month, date);
            const isFuture = this.isFutureDate(year, month, date);
            
            if (isToday || isFuture) {
                schedule.push({
                    date, dateStr, dayOfWeek,
                    status: 'skip',
                    reason: isToday ? '今天不可打卡' : '未來日期不可打卡',
                    shift: null, times: null
                });
                continue;
            }
            
            const isOnCall = onCallDays.has(dateStr);
            const isLeave = leaveDays.has(dateStr);
            const isOvertime = overtimeDays.has(dateStr);
            const shouldSkip = ScheduleRules.shouldSkipDate(year, month, date, onCallDays, leaveDays);
            
            if (shouldSkip && !isLeave) {
                schedule.push({
                    date, dateStr, dayOfWeek,
                    status: 'skip',
                    reason: this.getSkipReason(year, month, date, onCallDays, leaveDays),
                    shift: null, times: null
                });
            } else if (isLeave) {
                schedule.push({
                    date, dateStr, dayOfWeek,
                    status: 'leave', reason: '請假',
                    shift: null, times: null
                });
            } else {
                const shiftType = ScheduleRules.getShiftType(year, month, date, isOnCall, isLeave);
                
                if (shiftType) {
                    const shift = ScheduleRules.SHIFT_TYPES[shiftType];
                    let endTime = shift.endTime;
                    let shiftName = shift.name;
                    
                    if (isOvertime && shiftType === 'C02') {
                        endTime = '20:00';
                        shiftName = 'C02：8-20(加班)';
                    }
                    
                    schedule.push({
                        date, dateStr, dayOfWeek,
                        status: isOnCall ? 'oncall' : (isOvertime ? 'overtime' : 'regular'),
                        reason: isOnCall ? '值班' : (isOvertime ? '加班' : '一般上班'),
                        shift: shiftType, shiftName, isOvertime,
                        times: {
                            start: shift.startTime,
                            end: endTime,
                            isOvernight: shift.isOvernight || false
                        }
                    });
                }
            }
        }
        
        return schedule;
    }
    
    static getSkipReason(year, month, date, onCallDays, leaveDays) {
        const dayOfWeek = DateUtils.getDayOfWeek(year, month, date);
        
        const yesterday = new Date(year, month, date - 1);
        const yesterdayStr = DateUtils.formatDate(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate());
        if (onCallDays.has(yesterdayStr)) return '值班隔日';
        
        const tomorrow = new Date(year, month, date + 1);
        const tomorrowStr = DateUtils.formatDate(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate());
        if (dayOfWeek === 6 && tomorrow.getDay() === 0 && onCallDays.has(tomorrowStr)) {
            return '週日值班前一天';
        }
        
        return '跳過';
    }
    
    static isFutureDate(year, month, date) {
        const targetDate = new Date(year, month, date);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        targetDate.setHours(0, 0, 0, 0);
        return targetDate > today;
    }
}

/**
 * 中文星期對照
 */
const WEEKDAYS = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];
const WEEKDAYS_SHORT = ['日', '一', '二', '三', '四', '五', '六'];

// 導出所有工具類
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { DateUtils, ScheduleRules, ScheduleGenerator, WEEKDAYS, WEEKDAYS_SHORT };
}