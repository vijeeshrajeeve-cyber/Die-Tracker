import React, { useState, useRef, useEffect } from 'react';
import { MessageSquare, Send, X, Sparkles, Bot, Minimize2, Maximize2, RotateCcw, Wifi, WifiOff, RefreshCw } from 'lucide-react';
import { useAssistant } from '../hooks/useAssistant';

const ChatAssistant = ({ data, theme }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [isMinimized, setIsMinimized] = useState(false);
    const [inputText, setInputText] = useState('');
    const messagesEndRef = useRef(null);
    const inputRef = useRef(null);

    // Use the assistant hook with orders data
    const {
        messages,
        isTyping,
        isConnected,
        suggestedQueries,
        error,
        sendMessage,
        clearConversation,
        retryLastMessage
    } = useAssistant(data || []);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages, isOpen]);

    // Focus input when chat opens
    useEffect(() => {
        if (isOpen && !isMinimized && inputRef.current) {
            inputRef.current.focus();
        }
    }, [isOpen, isMinimized]);

    const handleSend = (e) => {
        e?.preventDefault();
        if (!inputText.trim() || isTyping) return;

        sendMessage(inputText);
        setInputText('');
    };

    const handleKeyDown = (e) => {
        // Submit on Enter, new line on Shift+Enter
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    const handleSuggestedQuery = (query) => {
        setInputText(query);
        sendMessage(query);
    };

    // Render markdown-like formatting (bold with **)
    const renderFormattedText = (text) => {
        return text.split('\n').map((line, i) => (
            <React.Fragment key={i}>
                {line.split(/(\*\*.*?\*\*)/).map((part, j) =>
                    part.startsWith('**') && part.endsWith('**')
                        ? <strong key={j}>{part.slice(2, -2)}</strong>
                        : part
                )}
                {i < text.split('\n').length - 1 && <br />}
            </React.Fragment>
        ));
    };

    if (!isOpen) {
        return (
            <button
                onClick={() => setIsOpen(true)}
                style={{
                    position: 'fixed',
                    bottom: '30px',
                    right: '30px',
                    width: '60px',
                    height: '60px',
                    borderRadius: '50%',
                    background: 'linear-gradient(135deg, #3B82F6, #8B5CF6)',
                    border: 'none',
                    boxShadow: '0 10px 25px rgba(59, 130, 246, 0.5)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    zIndex: 1000,
                    transition: 'transform 0.2s',
                }}
                onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.1)'}
                onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
                title="Open AI Assistant"
            >
                <Sparkles color="white" size={28} />
            </button>
        );
    }

    return (
        <div style={{
            position: 'fixed',
            bottom: '30px',
            right: '30px',
            width: isMinimized ? '320px' : '420px',
            height: isMinimized ? '60px' : '650px',
            background: theme.cardBg,
            borderRadius: '20px',
            border: `1px solid ${theme.cardBorder}`,
            boxShadow: '0 20px 50px rgba(0,0,0,0.3)',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            zIndex: 1000,
            transition: 'height 0.3s ease, width 0.3s ease',
            fontFamily: "'Inter', sans-serif"
        }}>
            {/* Header */}
            <div style={{
                padding: '16px 20px',
                background: 'linear-gradient(135deg, #3B82F6, #8B5CF6)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                cursor: 'pointer'
            }}
                onClick={() => !isMinimized && setIsMinimized(true)}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{
                        width: '36px', height: '36px', background: 'rgba(255,255,255,0.2)',
                        borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center'
                    }}>
                        <Bot color="white" size={22} />
                    </div>
                    <div>
                        <h3 style={{ margin: 0, color: 'white', fontSize: '1rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                            Expert
                            {isConnected !== null && (
                                <span title={isConnected ? 'AI Connected' : 'AI Offline'}>
                                    {isConnected ?
                                        <Wifi size={14} color="#4ADE80" /> :
                                        <WifiOff size={14} color="#F87171" />
                                    }
                                </span>
                            )}
                        </h3>
                        {!isMinimized && <p style={{ margin: 0, color: 'rgba(255,255,255,0.8)', fontSize: '0.75rem' }}>AI Assistant • Gemma3</p>}
                    </div>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                    {/* New Conversation Button */}
                    {!isMinimized && (
                        <button
                            onClick={(e) => { e.stopPropagation(); clearConversation(); }}
                            style={{ background: 'rgba(255,255,255,0.2)', border: 'none', cursor: 'pointer', padding: '6px', borderRadius: '6px' }}
                            title="New Conversation"
                        >
                            <RefreshCw color="white" size={16} />
                        </button>
                    )}
                    <button
                        onClick={(e) => { e.stopPropagation(); setIsMinimized(!isMinimized); }}
                        style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px' }}
                    >
                        {isMinimized ? <Maximize2 color="white" size={18} /> : <Minimize2 color="white" size={18} />}
                    </button>
                    <button
                        onClick={(e) => { e.stopPropagation(); setIsOpen(false); setIsMinimized(false); }}
                        style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px' }}
                    >
                        <X color="white" size={18} />
                    </button>
                </div>
            </div>

            {!isMinimized && (
                <>
                    {/* Messages Area */}
                    <div style={{
                        flex: 1,
                        padding: '20px',
                        overflowY: 'auto',
                        background: theme.bg,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '16px'
                    }}>
                        {messages.map(msg => (
                            <div key={msg.id} style={{
                                alignSelf: msg.type === 'user' ? 'flex-end' : 'flex-start',
                                maxWidth: '85%',
                            }}>
                                <div style={{
                                    padding: '12px 16px',
                                    borderRadius: msg.type === 'user' ? '20px 20px 4px 20px' : '20px 20px 20px 4px',
                                    background: msg.type === 'user' ? '#3B82F6' : msg.isError ? 'rgba(248, 113, 113, 0.1)' : theme.cardBg,
                                    border: msg.type === 'user' ? 'none' : msg.isError ? '1px solid #F87171' : `1px solid ${theme.border}`,
                                    color: msg.type === 'user' ? 'white' : theme.text,
                                    lineHeight: '1.5',
                                    fontSize: '0.9rem',
                                    boxShadow: '0 2px 5px rgba(0,0,0,0.05)'
                                }}>
                                    {renderFormattedText(msg.text)}

                                    {/* Show sources if available */}
                                    {msg.sources && msg.sources.length > 0 && (
                                        <div style={{
                                            marginTop: '8px',
                                            paddingTop: '8px',
                                            borderTop: `1px solid ${theme.border}`,
                                            fontSize: '0.75rem',
                                            color: theme.textDim
                                        }}>
                                            Sources: {msg.sources.join(', ')}
                                        </div>
                                    )}

                                    {/* Retry button for errors */}
                                    {msg.isError && (
                                        <button
                                            onClick={retryLastMessage}
                                            style={{
                                                marginTop: '8px',
                                                padding: '6px 12px',
                                                background: 'transparent',
                                                border: '1px solid #F87171',
                                                color: '#F87171',
                                                borderRadius: '8px',
                                                cursor: 'pointer',
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '4px',
                                                fontSize: '0.8rem'
                                            }}
                                        >
                                            <RotateCcw size={14} /> Retry
                                        </button>
                                    )}
                                </div>
                                <span style={{
                                    display: 'block',
                                    fontSize: '0.7rem',
                                    color: theme.textDim,
                                    marginTop: '4px',
                                    textAlign: msg.type === 'user' ? 'right' : 'left',
                                    padding: '0 4px'
                                }}>
                                    {msg.type === 'bot' ? 'Expert' : 'You'}
                                </span>
                            </div>
                        ))}

                        {/* Typing indicator */}
                        {isTyping && (
                            <div style={{ alignSelf: 'flex-start', display: 'flex', gap: '4px', padding: '12px 16px', background: theme.cardBg, borderRadius: '20px', border: `1px solid ${theme.border}` }}>
                                <div style={{ width: '8px', height: '8px', background: '#94A3B8', borderRadius: '50%', animation: 'bounce 1s infinite', animationDelay: '0s' }} />
                                <div style={{ width: '8px', height: '8px', background: '#94A3B8', borderRadius: '50%', animation: 'bounce 1s infinite', animationDelay: '0.2s' }} />
                                <div style={{ width: '8px', height: '8px', background: '#94A3B8', borderRadius: '50%', animation: 'bounce 1s infinite', animationDelay: '0.4s' }} />
                                <style>{`@keyframes bounce { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-5px); } }`}</style>
                            </div>
                        )}
                        <div ref={messagesEndRef} />
                    </div>

                    {/* Suggested Queries */}
                    {suggestedQueries.length > 0 && !isTyping && (
                        <div style={{
                            padding: '8px 16px',
                            background: theme.cardBg,
                            borderTop: `1px solid ${theme.border}`,
                            display: 'flex',
                            flexWrap: 'wrap',
                            gap: '8px'
                        }}>
                            {suggestedQueries.map((query, idx) => (
                                <button
                                    key={idx}
                                    onClick={() => handleSuggestedQuery(query)}
                                    style={{
                                        padding: '6px 12px',
                                        background: theme.bg,
                                        border: `1px solid ${theme.border}`,
                                        borderRadius: '16px',
                                        color: theme.text,
                                        fontSize: '0.75rem',
                                        cursor: 'pointer',
                                        transition: 'background 0.2s, border-color 0.2s'
                                    }}
                                    onMouseEnter={e => {
                                        e.currentTarget.style.background = '#3B82F6';
                                        e.currentTarget.style.borderColor = '#3B82F6';
                                        e.currentTarget.style.color = 'white';
                                    }}
                                    onMouseLeave={e => {
                                        e.currentTarget.style.background = theme.bg;
                                        e.currentTarget.style.borderColor = theme.border;
                                        e.currentTarget.style.color = theme.text;
                                    }}
                                >
                                    {query}
                                </button>
                            ))}
                        </div>
                    )}

                    {/* Input Area */}
                    <form onSubmit={handleSend} style={{
                        padding: '16px',
                        background: theme.cardBg,
                        borderTop: `1px solid ${theme.border}`,
                        display: 'flex',
                        gap: '10px'
                    }}>
                        <textarea
                            ref={inputRef}
                            value={inputText}
                            onChange={(e) => setInputText(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder="Ask about orders or processes..."
                            rows={1}
                            style={{
                                flex: 1,
                                padding: '12px 16px',
                                borderRadius: '24px',
                                border: `1px solid ${theme.border}`,
                                background: theme.inputBg,
                                color: theme.text,
                                outline: 'none',
                                fontSize: '0.95rem',
                                resize: 'none',
                                fontFamily: 'inherit',
                                maxHeight: '100px',
                                minHeight: '44px'
                            }}
                        />
                        <button
                            type="submit"
                            disabled={!inputText.trim() || isTyping}
                            style={{
                                width: '44px',
                                height: '44px',
                                borderRadius: '50%',
                                background: inputText.trim() && !isTyping ? '#3B82F6' : theme.border,
                                border: 'none',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                cursor: inputText.trim() && !isTyping ? 'pointer' : 'default',
                                transition: 'background 0.2s',
                                flexShrink: 0
                            }}
                        >
                            <Send color="white" size={20} />
                        </button>
                    </form>
                </>
            )}
        </div>
    );
};

export default ChatAssistant;
