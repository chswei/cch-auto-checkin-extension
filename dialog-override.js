// 對話框覆寫腳本 - 在頁面環境中執行
// 這個文件會被注入到頁面中，繞過 CSP 限制

// 覆寫原生對話框函數
window.confirm = function(message) {
    return true; // 自動確認
};

window.alert = function(message) {
    // 不顯示 alert，直接跳過
};