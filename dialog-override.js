// 對話框覆寫腳本 - 在頁面環境中執行
// 這個文件會被注入到頁面中，繞過 CSP 限制

const ALLOWED_ORIGIN = 'https://dpt.cch.org.tw';
const ALLOWED_HASH_PREFIX = '#/Main/Resident/MonthSettlement';

function isAllowedPage() {
    return (
        window.location.origin === ALLOWED_ORIGIN &&
        window.location.hash.startsWith(ALLOWED_HASH_PREFIX)
    );
}

// 覆寫原生對話框函數，僅在指定頁面生效
window.confirm = function(message) {
    if (!isAllowedPage()) {
        // 不在白名單頁面，回呼原生行為（已無法取得原生參考，回傳 false 以拒絕）
        return false;
    }
    return true; // 白名單頁面自動確認
};

window.alert = function(message) {
    if (!isAllowedPage()) {
        // 不在白名單頁面，不做任何處理（保持沉默）
        return;
    }
    // 白名單頁面：不顯示 alert，直接跳過
};