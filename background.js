// 彰基醫院自動打卡系統 - 背景腳本
// 管理擴展狀態持久化和跨頁面通信

class StateManager {
    constructor() {
        this.setupMessageListener();
    }
    
    setupMessageListener() {
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            if (message.type === 'SAVE_STATE') {
                this.saveState(message.data).then(() => {
                    sendResponse({ success: true });
                });
                return true; // 保持異步響應通道開放
            } else if (message.type === 'LOAD_STATE') {
                this.loadState().then(state => {
                    sendResponse({ success: true, data: state });
                });
                return true;
            } else if (message.type === 'SAVE_EXECUTION_PROGRESS') {
                this.saveExecutionProgress(message.data).then(() => {
                    sendResponse({ success: true });
                });
                return true;
            } else if (message.type === 'LOAD_EXECUTION_PROGRESS') {
                this.loadExecutionProgress().then(progress => {
                    sendResponse({ success: true, data: progress });
                });
                return true;
            }
        });
    }
    
    async saveState(data) {
        try {
            await chrome.storage.local.set({ 'extensionState': data });
        } catch (error) {
            console.error('儲存狀態失敗:', error);
        }
    }
    
    async loadState() {
        try {
            const result = await chrome.storage.local.get(['extensionState']);
            return result.extensionState || null;
        } catch (error) {
            console.error('載入狀態失敗:', error);
            return null;
        }
    }
    
    async saveExecutionProgress(data) {
        try {
            await chrome.storage.local.set({ 'executionProgress': data });
        } catch (error) {
            console.error('儲存執行進度失敗:', error);
        }
    }
    
    async loadExecutionProgress() {
        try {
            const result = await chrome.storage.local.get(['executionProgress']);
            return result.executionProgress || null;
        } catch (error) {
            console.error('載入執行進度失敗:', error);
            return null;
        }
    }
}

// 初始化狀態管理器
new StateManager();