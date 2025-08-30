// 對話框覆寫腳本 - 在頁面環境中執行
// 這個文件會被注入到頁面中，繞過 CSP 限制

console.log('[彰基自動打卡] 對話框覆寫腳本開始執行');

// 覆寫原生對話框函數
window.confirm = function(message) {
    console.log('[彰基自動打卡] 攔截 confirm:', message);
    return true; // 自動確認
};

window.alert = function(message) {
    console.log('[彰基自動打卡] 攔截 alert:', message);
    // 不顯示 alert，直接跳過
};

console.log('[彰基自動打卡] 原生對話框函數已覆寫');