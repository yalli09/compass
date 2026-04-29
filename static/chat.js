// Chat Widget JS - Handles all chat interactions
// Integrates with SocketIO backend and llm_model.py

class ChatWidget {
    constructor() {
        // DOM Elements
        this.chatToggleBtn = document.getElementById('chatToggleBtn');
        this.chatWidget = document.getElementById('chatWidget');
        this.chatCloseBtn = document.getElementById('chatClose');
        this.chatMessages = document.getElementById('chatMessages');
        this.chatInput = document.getElementById('chatInput');
        this.chatSendBtn = document.getElementById('chatSendBtn');
        
        // State
        this.isOpen = false;
        this.sessionId = null;
        this.socket = io();
        this.isWaitingForResponse = false;
        
        // Initialize
        this.init();
    }
    
    init() {
        // Socket.IO event listeners
        this.socket.on('session_id', (data) => {
            this.sessionId = data.session_id;
            console.log('Chat session initialized');
            this.addSystemMessage('✓ Chat ready! Ask me anything about your trip.');
        });
        
        this.socket.on('chat_response', (data) => {
            this.handleChatResponse(data);
        });
        
        this.socket.on('error', (data) => {
            this.addErrorMessage(data.message);
        });
        
        this.socket.on('disconnect', () => {
            this.addSystemMessage('⚠ Connection lost. Attempting to reconnect...');
            this.chatSendBtn.disabled = true;
        });
        
        this.socket.on('connect', () => {
            this.chatSendBtn.disabled = false;
            this.addSystemMessage('✓ Reconnected!');
        });
        
        this.socket.on('connect_error', (error) => {
            console.error('Connection error:', error);
            this.addErrorMessage('Connection issue - please refresh the page');
        });
        
        // DOM event listeners
        this.chatToggleBtn.addEventListener('click', () => this.toggle());
        this.chatCloseBtn.addEventListener('click', () => this.close());
        this.chatSendBtn.addEventListener('click', () => this.sendMessage());
        this.chatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });
    }
    
    toggle() {
        if (this.isOpen) {
            this.close();
        } else {
            this.open();
        }
    }
    
    open() {
        this.isOpen = true;
        this.chatWidget.classList.remove('hidden');
        this.chatToggleBtn.style.opacity = '0.5';
        this.chatInput.focus();
    }
    
    close() {
        this.isOpen = false;
        this.chatWidget.classList.add('hidden');
        this.chatToggleBtn.style.opacity = '1';
    }
    
    sendMessage() {
        if (this.isWaitingForResponse) {
            return; // Prevent sending while waiting for response
        }
        
        const message = this.chatInput.value.trim();
        if (!message || !this.sessionId) {
            if (!this.sessionId) {
                this.addErrorMessage('Session not initialized. Please refresh the page.');
            }
            return;
        }
        
        // Clear input
        this.chatInput.value = '';
        
        // Disable send button during request
        this.isWaitingForResponse = true;
        this.chatSendBtn.disabled = true;
        
        // Send message to backend
        this.socket.emit('chat_message', {
            session_id: this.sessionId,
            message: message
        });
        
        // Show loading indicator
        this.addLoadingMessage();
    }
    
    handleChatResponse(data) {
        const { role, content } = data;
        
        // Remove loading indicator if it exists
        const loadingMsg = this.chatMessages.querySelector('.chat-message.loading');
        if (loadingMsg && role === 'assistant') {
            loadingMsg.remove();
        }
        
        // Add message to display
        this.addMessage(content, role);
        
        // Re-enable send button
        if (role === 'assistant') {
            this.isWaitingForResponse = false;
            this.chatSendBtn.disabled = false;
            this.chatInput.focus();
        }
        
        // Auto-scroll to bottom
        this.scrollToBottom();
    }
    
    addMessage(content, role) {
        const msgDiv = document.createElement('div');
        msgDiv.className = `chat-message ${role}`;
        msgDiv.textContent = content;
        this.chatMessages.appendChild(msgDiv);
        this.scrollToBottom();
    }
    
    addLoadingMessage() {
        const msgDiv = document.createElement('div');
        msgDiv.className = 'chat-message loading';
        msgDiv.textContent = 'Thinking...';
        this.chatMessages.appendChild(msgDiv);
        this.scrollToBottom();
    }
    
    addSystemMessage(content) {
        const msgDiv = document.createElement('div');
        msgDiv.className = 'chat-message assistant';
        msgDiv.style.fontSize = '0.85rem';
        msgDiv.style.fontStyle = 'italic';
        msgDiv.textContent = content;
        this.chatMessages.appendChild(msgDiv);
        this.scrollToBottom();
    }
    
    addErrorMessage(content) {
        const msgDiv = document.createElement('div');
        msgDiv.className = 'chat-message assistant';
        msgDiv.style.backgroundColor = 'rgba(255, 107, 107, 0.1)';
        msgDiv.style.color = '#d32f2f';
        msgDiv.textContent = 'Error: ' + content;
        this.chatMessages.appendChild(msgDiv);
        this.scrollToBottom();
        
        // Re-enable send button on error
        this.isWaitingForResponse = false;
        this.chatSendBtn.disabled = false;
    }
    
    scrollToBottom() {
        this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
    }
}

// Initialize chat widget when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.chatWidget = new ChatWidget();
});
