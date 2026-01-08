import React, { useState, useEffect, useRef } from 'react';
import './i18n';
import { useTranslation } from 'react-i18next';

// ==========================================
// ★アイコン定義
// ==========================================
const EMOJI = {
  TERMINAL: '💻',
  PLAYERS: '👥',
  BAN: '🚫',
  SETTINGS: '⚙️',
  SEARCH: '🔍',
  DISCONNECT: '🔌',
  CONNECT: '🔗',
  REFRESH: '🔄',
  COPY: '📄',
  KICK: '👢',
  UNLOCK: '🔓',
  ZAP: '⚡',
  WORLD: '🌍',
  CHECK: '✅',
  CLOSE: '✖️'
};

// --- 型定義 ---
interface Player {
  id: string;
  name: string;
  country: string;
  countryCode: string;
  city: string;
  steamId: string;
  ip: string;
  ping: number;
  totalPlaytime: string;
  connectedSeconds: number;
  isOnline: boolean;
  lastSeen: Date;
}

interface BannedPlayer {
  steamId: string;
  name: string;
  reason: string;
}

interface ConnectionConfig {
  ip: string;
  port: number;
  rconPort: number;
  password: string;
  serverName: string;
  steamApiKey: string;
  autoBan: boolean;
  autoConnect: boolean;
}

interface RustPlayerRaw {
  SteamID: string;
  DisplayName: string;
  Ping: number;
  Address: string;
  ConnectedSeconds: number;
  Health: number;
}

// モーダル管理用の型
interface ActionModalState {
  isOpen: boolean;
  type: 'kick' | 'ban' | null;
  steamId: string;
  playerName: string;
}

const DEFAULT_CONFIG: ConnectionConfig = {
  ip: '127.0.0.1', port: 28015, rconPort: 28016, password: '', serverName: 'My Rust Server', steamApiKey: '', autoBan: false, autoConnect: false
};

function App(): React.JSX.Element {
  const { t, i18n } = useTranslation(undefined, { useSuspense: false });
  const [activeTab, setActiveTab] = useState<'console' | 'players' | 'banlist' | 'settings'>('settings');
  const [consoleLogs, setConsoleLogs] = useState<string[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<'disconnected' | 'connecting' | 'connected' | 'error'>('disconnected');
  const [commandInput, setCommandInput] = useState('');
  
  const [searchTerm, setSearchTerm] = useState('');
  const [players, setPlayers] = useState<Player[]>([]);
  const [bannedPlayers, setBannedPlayers] = useState<BannedPlayer[]>([]);

  // コピー成功時のエフェクト管理
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // アクション用モーダル管理
  const [modalState, setModalState] = useState<ActionModalState>({ isOpen: false, type: null, steamId: '', playerName: '' });
  const [modalReason, setModalReason] = useState('');
  
  const playersRef = useRef<Player[]>([]);
  const activeTabRef = useRef(activeTab); 
  const didAutoConnect = useRef(false);

  // 設定データ
  const [config, setConfig] = useState<ConnectionConfig>(() => {
    try {
      const saved = localStorage.getItem('rconConfig');
      if(saved) {
        const parsed = JSON.parse(saved);
        return { ...DEFAULT_CONFIG, ...parsed };
      }
    } catch (e) {}
    return DEFAULT_CONFIG;
  });

  const consoleEndRef = useRef<HTMLDivElement>(null);
  const pollingTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    activeTabRef.current = activeTab;
  }, [activeTab]);

  useEffect(() => {
    localStorage.setItem('rconConfig', JSON.stringify(config));
  }, [config]);

  // オートコネクト
  useEffect(() => {
    if (!didAutoConnect.current && config.autoConnect) {
      didAutoConnect.current = true;
      setTimeout(() => handleToggleConnection(true), 500);
    }
  }, []);

  // 履歴読み込み
  useEffect(() => {
    try {
      const saved = localStorage.getItem('rconPlayers');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          const restored = parsed.map((p: any) => ({
            ...p,
            countryCode: p.countryCode || '', 
            lastSeen: p.lastSeen ? new Date(p.lastSeen) : new Date(),
            isOnline: false 
          }));
          setPlayers(restored);
          playersRef.current = restored;
        }
      }
    } catch (e) {}
  }, []);

  useEffect(() => {
    if (players.length > 0 || connectionStatus === 'connected') {
      localStorage.setItem('rconPlayers', JSON.stringify(players));
    }
    playersRef.current = players;
  }, [players, connectionStatus]);

  const fetchGeoInfo = async (ip: string) => {
    if (window.api && window.api.getGeo) {
      try { return await window.api.getGeo(ip); } catch (e) {}
    }
    return { country: 'Unknown', city: 'Unknown', countryCode: '' };
  };

  const formatTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h}h ${m}m`;
  };

  // --- RCON イベント ---
  useEffect(() => {
    if (window.api) {
      window.api.onRconLog((log: string) => {
        try {
          const trimLog = log.trim();
          
          // 1. コマンドエコーやヘッダーを無視
          if (
             trimLog === 'playerlist' || 
             trimLog === 'banlist' ||
             (trimLog.includes('SteamID') && trimLog.includes('Username') && trimLog.includes('Reason') && !trimLog.startsWith('['))
          ) return;

          // 2. playerlist (JSON)
          if (trimLog.startsWith('[') && trimLog.includes('"SteamID"')) {
            const rawList: RustPlayerRaw[] = JSON.parse(log);
            updatePlayerList(rawList);
            return;
          }

          // ★★★ 保護ガード (戦闘ログ + 接続ログ) ★★★
          // 以下の単語が含まれていたら、Banリストっぽくても絶対に表示する
          const isImportantLog = /killed|died|suicide|bleeding|wounded|landmine|joined|connected|disconnected|left|disconnecting/i.test(trimLog);

          if (!isImportantLog) {
            // 3. banlist (テキスト行) の処理
            // 重要なログでない場合のみ、Banリストかどうかチェックして隠す
            const banMatch = log.match(/(?:^|\s)(\d{17})\s+"([^"]+)"\s+"([^"]*)"/);
            
            if (banMatch) {
               const steamId = banMatch[1];
               const name = banMatch[2];
               const reason = banMatch[3];

               setBannedPlayers(prev => {
                 if (prev.some(p => p.steamId === steamId)) return prev;
                 return [...prev, { steamId, name, reason }];
               });
               
               // Banリストデータなのでコンソールには出さない
               return; 
            }
          }

        } catch (e) {}
        
        // それ以外は全て表示
        setConsoleLogs(prev => [...prev, log].slice(-1000));
      });

      window.api.onRconConnected(() => {
        setConnectionStatus('connected');
        setConsoleLogs(prev => [...prev, `[SYSTEM] Connected successfully.`]);
        if (activeTabRef.current !== 'banlist') setActiveTab('console');
        startPolling();
      });

      window.api.onRconDisconnected(() => {
        setConnectionStatus('disconnected');
        setConsoleLogs(prev => [...prev, `[SYSTEM] Disconnected.`]);
        stopPolling();
      });

      window.api.onRconError((err: string) => {
        setConnectionStatus('error');
        setConsoleLogs(prev => [...prev, `[ERROR] ${err}`]);
        stopPolling();
      });
      
      if (window.api.onRconStatus) {
        window.api.onRconStatus((status: any) => {
          setConnectionStatus(status);
        });
      }
    }
    return () => {
      stopPolling();
      if (window.api) window.api.removeAllListeners();
    };
  }, []);

  const startPolling = () => {
    if (pollingTimerRef.current) clearInterval(pollingTimerRef.current);
    window.api.sendRconCommand('playerlist');
    pollingTimerRef.current = setInterval(() => {
      window.api.sendRconCommand('playerlist');
    }, 5000);
  };

  const stopPolling = () => {
    if (pollingTimerRef.current) {
      clearInterval(pollingTimerRef.current);
      pollingTimerRef.current = null;
    }
  };

  const refreshBanList = () => {
    setBannedPlayers([]);
    if (window.api) window.api.sendRconCommand('banlist');
  };

  useEffect(() => {
    if (activeTab === 'banlist' && connectionStatus === 'connected') {
        refreshBanList();
    }
  }, [activeTab]);

  const updatePlayerList = async (rawList: RustPlayerRaw[]) => {
    const currentPlayers = [...playersRef.current];
    const newOnlineIds = new Set(rawList.map(r => r.SteamID));
    
    for (const raw of rawList) {
      const ipOnly = raw.Address.split(':')[0];
      const existingIndex = currentPlayers.findIndex(p => p.steamId === raw.SteamID);
      
      if (existingIndex !== -1) {
        const existingPlayer = currentPlayers[existingIndex];
        
        let newCountry = existingPlayer.country;
        let newCode = existingPlayer.countryCode;
        let newCity = existingPlayer.city;

        if (!newCountry || newCountry === 'Unknown' || newCountry === 'Local') {
           const geo = await fetchGeoInfo(ipOnly);
           if (geo.country !== 'Unknown') {
             newCountry = geo.country;
             newCode = geo.countryCode;
             newCity = geo.city;
           }
        }

        currentPlayers[existingIndex] = {
          ...existingPlayer,
          name: raw.DisplayName,
          ping: raw.Ping,
          connectedSeconds: raw.ConnectedSeconds,
          sessionPlaytime: formatTime(raw.ConnectedSeconds),
          isOnline: true,
          lastSeen: new Date(),
          country: newCountry,
          countryCode: newCode,
          city: newCity
        };
      } else {
        const geo = await fetchGeoInfo(ipOnly);
        currentPlayers.push({
          id: raw.SteamID,
          name: raw.DisplayName,
          country: geo.country,
          countryCode: geo.countryCode,
          city: geo.city,
          steamId: raw.SteamID,
          ip: ipOnly,
          ping: raw.Ping,
          totalPlaytime: 'Loading...', 
          connectedSeconds: raw.ConnectedSeconds,
          sessionPlaytime: formatTime(raw.ConnectedSeconds),
          isOnline: true,
          lastSeen: new Date()
        });
      }
    }

    for (const player of currentPlayers) {
      if (!newOnlineIds.has(player.steamId) && player.isOnline) {
        player.isOnline = false;
      }
    }
    setPlayers(currentPlayers);
    playersRef.current = currentPlayers;
  };

  useEffect(() => {
    consoleEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [consoleLogs]);

  // --- アクション ---
  const handleToggleConnection = async (forceConnect = false) => {
    if (!window.api) return;

    if (!forceConnect && (connectionStatus === 'connected' || connectionStatus === 'connecting')) {
      await window.api.disconnectRcon();
      setConnectionStatus('disconnected');
      setConsoleLogs(prev => [...prev, `[SYSTEM] Connection closed/canceled by user.`]);
      return;
    }

    if (forceConnect || connectionStatus === 'disconnected' || connectionStatus === 'error') {
      if (!config.ip || !config.rconPort || !config.password) {
        setConsoleLogs(prev => [...prev, `[SYSTEM] Error: IP, Port, or Password is missing.`]);
        return;
      }

      setConnectionStatus('connecting');
      setConsoleLogs(prev => [...prev, `[SYSTEM] Connecting to ${config.ip}:${config.rconPort} via WebRCON...`]);
      
      await window.api.connectRcon({
        host: config.ip,
        port: config.rconPort,
        password: config.password
      });

      setTimeout(() => {
        setConnectionStatus(current => {
          if (current === 'connecting') {
            setConsoleLogs(prev => [...prev, `[SYSTEM] Connection timed out (10s).`]);
            window.api.disconnectRcon();
            return 'error';
          }
          return current;
        });
      }, 10000);
    }
  };

  const handleReconnect = async () => {
    if (!window.api) return;
    if (connectionStatus === 'connected') {
      await window.api.disconnectRcon();
      setConnectionStatus('disconnected');
      setConsoleLogs(prev => [...prev, `[SYSTEM] Reconnecting...`]);
      setTimeout(() => handleToggleConnection(true), 1000);
    } else {
      handleToggleConnection(true);
    }
  };

  const handleSendCommand = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!commandInput.trim() || !window.api) return;
    await window.api.sendRconCommand(commandInput);
    setCommandInput('');
  };

  // アクションボタンクリック時の処理 (モーダルを開く)
  const openActionModal = (steamId: string, action: 'kick' | 'ban', playerName: string) => {
    console.log(`Open Action Modal: ${action} for ${playerName}`);
    setModalReason(action === 'kick' ? 'Kicked by Admin' : 'Banned by Admin');
    setModalState({ isOpen: true, type: action, steamId, playerName });
  };

  // モーダルからの実行処理
  const executeModalAction = async () => {
    if (!window.api || !modalState.type) return;
    
    const command = `${modalState.type} ${modalState.steamId} "${modalReason}"`;
    setConsoleLogs(prev => [...prev, `[ADMIN] Executing: ${command}`]);
    
    await window.api.sendRconCommand(command);
    
    // 完了通知とクローズ
    setModalState({ ...modalState, isOpen: false });
    if (modalState.type === 'ban') {
        setTimeout(refreshBanList, 1000);
    }
  };

  const executeUnban = async (steamId: string) => {
    if (!window.api) return;
    if (confirm(`Are you sure you want to unban SteamID: ${steamId}?`)) {
      await window.api.sendRconCommand(`unban ${steamId}`);
      setBannedPlayers(prev => prev.filter(p => p.steamId !== steamId));
      setTimeout(refreshBanList, 1000);
    }
  };

  // コピー機能
  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000); // 2秒後に戻す
  };

  // --- UI ---
  // モーダルコンポーネント
  const renderModal = () => {
    if (!modalState.isOpen) return null;
    return (
      <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
        <div className="bg-gray-800 border border-gray-600 rounded-lg p-6 w-96 shadow-2xl">
          <h3 className="text-xl font-bold text-white mb-2 uppercase flex items-center gap-2">
            {modalState.type === 'kick' ? EMOJI.KICK : EMOJI.BAN} {modalState.type} PLAYER
          </h3>
          <p className="text-gray-300 mb-4 text-sm">Target: <span className="font-mono text-yellow-400">{modalState.playerName}</span></p>
          
          <label className="block text-xs text-gray-500 mb-1">Reason:</label>
          <input 
            className="w-full bg-gray-900 border border-gray-700 rounded p-2 text-white mb-4 focus:border-blue-500 outline-none"
            value={modalReason}
            onChange={(e) => setModalReason(e.target.value)}
            autoFocus
          />
          
          <div className="flex justify-end gap-2">
            <button 
              onClick={() => setModalState({ ...modalState, isOpen: false })}
              className="px-4 py-2 text-gray-400 hover:text-white"
            >
              Cancel
            </button>
            <button 
              onClick={executeModalAction}
              className={`px-4 py-2 rounded text-white font-bold ${modalState.type === 'ban' ? 'bg-red-600 hover:bg-red-700' : 'bg-yellow-600 hover:bg-yellow-700'}`}
            >
              Execute
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderConsole = () => {
    const filteredLogs = consoleLogs.filter(log => 
      log.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const getLogColor = (log: string) => {
      if (log.includes('[Error]') || log.includes('Exception')) return 'text-red-400';
      if (log.includes('[Warning]')) return 'text-yellow-400';
      if (log.includes('[Chat]')) return 'text-cyan-400';
      if (log.startsWith('[SYSTEM]') || log.startsWith('[ADMIN]')) return 'text-blue-400';
      return 'text-green-400';
    };

    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center p-2 bg-gray-800 border-b border-gray-700">
          <span className="text-gray-400 mr-2">{EMOJI.SEARCH}</span>
          <input 
            type="text" 
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)} 
            placeholder="Search logs..." 
            className="bg-transparent border-none focus:outline-none text-gray-200 text-sm w-full"
          />
          {searchTerm && (
            <button onClick={() => setSearchTerm('')} className="text-gray-500 hover:text-white px-2">×</button>
          )}
        </div>
        <div className="flex-1 overflow-y-auto p-4 bg-gray-950 font-mono text-xs space-y-1 select-text">
          {filteredLogs.map((log, i) => (
            <div key={i} className={`whitespace-pre-wrap break-all border-b border-gray-800/30 pb-0.5 ${getLogColor(log)}`}>
              {log}
            </div>
          ))}
          <div ref={consoleEndRef} />
        </div>
        <form onSubmit={handleSendCommand} className="p-2 bg-gray-800 border-t border-gray-700 flex">
          <input type="text" value={commandInput} onChange={(e) => setCommandInput(e.target.value)} className="flex-1 bg-gray-900 text-white p-2 rounded border border-gray-600 focus:border-blue-500 outline-none" placeholder="Enter RCON command..." />
          <button type="submit" className="ml-2 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-500">Send</button>
        </form>
      </div>
    );
  };

  const renderBanList = () => (
    <div className="h-full overflow-y-auto p-6 relative">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          {EMOJI.BAN} Ban List
        </h2>
        <button onClick={refreshBanList} className="text-xs bg-gray-800 hover:bg-gray-700 text-white px-3 py-1 rounded flex items-center gap-1 border border-gray-700">
          {EMOJI.REFRESH} Refresh
        </button>
      </div>
      <div className="bg-gray-800 rounded-lg overflow-hidden border border-gray-700 shadow-lg">
        <table className="w-full text-left text-sm text-gray-300">
          <thead className="bg-gray-900 text-gray-400 uppercase text-xs">
            <tr>
              <th className="px-4 py-3">SteamID</th>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Reason</th>
              <th className="px-4 py-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-700">
            {bannedPlayers.map((player) => (
              <tr key={player.steamId} className="hover:bg-gray-700/50 transition-colors">
                <td className="px-4 py-3 font-mono text-xs text-blue-400 cursor-pointer hover:underline" onClick={() => handleCopy(player.steamId, player.steamId)}>{player.steamId}</td>
                <td className="px-4 py-3 font-medium text-white">{player.name}</td>
                <td className="px-4 py-3 text-red-300">{player.reason}</td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => executeUnban(player.steamId)} className="text-xs bg-green-900/50 hover:bg-green-800 text-green-300 px-2 py-1 rounded border border-green-800 flex items-center gap-1 ml-auto">
                    {EMOJI.UNLOCK} Unban
                  </button>
                </td>
              </tr>
            ))}
            {bannedPlayers.length === 0 && (
              <tr>
                <td colSpan={4} className="p-8 text-center text-gray-500 text-sm">
                  {connectionStatus === 'connected' ? "No banned players found." : "Connect to server to view ban list."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );

  const renderPlayers = () => {
    const onlinePlayers = players.filter(p => p.isOnline);
    const historyPlayers = players.filter(p => !p.isOnline).sort((a,b) => {
      const tA = new Date(a.lastSeen).getTime();
      const tB = new Date(b.lastSeen).getTime();
      return (isNaN(tB) ? 0 : tB) - (isNaN(tA) ? 0 : tA);
    });

    const PlayerTable = ({ list, title, isHistory }: { list: Player[], title: string, isHistory?: boolean }) => (
      <div className="mb-6">
        <h3 className="text-lg font-bold text-gray-200 mb-2 px-2 flex items-center gap-2">
          {title} <span className="bg-gray-700 text-xs px-2 py-0.5 rounded-full">{list.length}</span>
        </h3>
        <div className="bg-gray-800 rounded-lg overflow-hidden border border-gray-700 shadow-lg">
          <table className="w-full text-left text-sm text-gray-300">
            <thead className="bg-gray-900 text-gray-400 uppercase text-xs">
              <tr>
                <th className="px-4 py-3">{t('players.headers.name')}</th>
                <th className="px-4 py-3">{t('players.headers.country')}</th>
                <th className="px-4 py-3">{t('players.headers.steamid')}</th>
                <th className="px-4 py-3">{t('players.headers.ip')}</th>
                <th className="px-4 py-3">{t('players.headers.ping')}</th>
                <th className="px-4 py-3">{t('players.headers.session')}</th>
                <th className="px-4 py-3 text-right">{t('players.headers.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700">
              {list.map(player => (
                <tr key={player.id} className={`hover:bg-gray-700/50 transition-colors ${isHistory ? 'opacity-60 grayscale hover:grayscale-0 hover:opacity-100' : ''}`}>
                  <td className="px-4 py-3 font-medium text-white flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${isHistory ? 'bg-gray-500' : 'bg-green-500'}`}></div>
                    {player.name}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {player.countryCode ? (
                        <img 
                          src={`https://flagcdn.com/w40/${player.countryCode.toLowerCase()}.png`} 
                          alt={player.countryCode} 
                          className="w-6 h-auto shadow-sm rounded-sm"
                          onError={(e) => { e.currentTarget.style.display = 'none'; }}
                        />
                      ) : (
                        <span className="text-xl">{EMOJI.WORLD}</span>
                      )}
                      
                      <div className="flex flex-col">
                        <span className="text-xs">{player.country}</span>
                        {player.city && player.city !== 'Unknown' && <span className="text-[10px] text-gray-500">{player.city}</span>}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs cursor-pointer hover:text-white" onClick={() => handleCopy(player.steamId, player.steamId)}>
                     {player.steamId}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs cursor-pointer hover:text-white" onClick={() => handleCopy(player.ip, player.ip)}>
                     {player.ip}
                  </td>
                  <td className="px-4 py-3">
                    {isHistory ? '-' : <span className={`px-2 py-0.5 rounded text-xs ${player.ping < 50 ? 'bg-green-900/50 text-green-300' : 'bg-red-900/50 text-red-300'}`}>{player.ping}ms</span>}
                  </td>
                  <td className="px-4 py-3 text-xs font-mono">{player.sessionPlaytime}</td>
                  <td className="px-4 py-3 text-right flex justify-end gap-1">
                    {/* コピーボタン */}
                    <button 
                      onClick={() => handleCopy(player.steamId, player.id)} 
                      className="p-1.5 hover:bg-gray-600 rounded transition-colors"
                      title="Copy SteamID"
                    >
                      {copiedId === player.id ? EMOJI.CHECK : EMOJI.COPY}
                    </button>
                    
                    {/* アクションボタン */}
                    <button onClick={() => openActionModal(player.steamId, 'kick', player.name)} className="p-1.5 hover:bg-yellow-900/50 rounded transition-colors text-yellow-400" title="Kick Player">{EMOJI.KICK}</button>
                    <button onClick={() => openActionModal(player.steamId, 'ban', player.name)} className="p-1.5 hover:bg-red-900/50 rounded transition-colors text-red-500" title="Ban Player">{EMOJI.BAN}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {list.length === 0 && <div className="p-8 text-center text-gray-500 text-sm">No players found.</div>}
        </div>
      </div>
    );

    return (
      <div className="h-full overflow-y-auto p-4 relative">
         {/* モーダル */}
         {renderModal()}
         
         <div className="absolute top-4 right-6 text-xs text-gray-500 flex items-center gap-1 animate-pulse">
            <span className="bg-gray-800 px-2 py-1 rounded text-[10px] text-gray-400 border border-gray-700">
              Auto-refreshing {EMOJI.ZAP}
            </span>
         </div>
        <PlayerTable list={onlinePlayers} title={t('players.online')} />
        <PlayerTable list={historyPlayers} title={t('players.history')} isHistory />
      </div>
    );
  };

  const renderSettings = () => (
    <div className="p-6 max-w-4xl mx-auto space-y-8 overflow-y-auto h-full">
      <section>
        <h2 className="text-xl font-bold text-white mb-4 border-b border-gray-700 pb-2">{t('settings.connection')}</h2>
        <div className="grid grid-cols-2 gap-4">
          <div><label className="block text-sm text-gray-400 mb-1">Server Name</label><input type="text" className="w-full bg-gray-800 border border-gray-600 rounded p-2 text-white" value={config.serverName} onChange={(e) => setConfig({...config, serverName: e.target.value})} /></div>
          <div><label className="block text-sm text-gray-400 mb-1">IP Address</label><input type="text" className="w-full bg-gray-800 border border-gray-600 rounded p-2 text-white" value={config.ip} onChange={(e) => setConfig({...config, ip: e.target.value})} /></div>
          <div><label className="block text-sm text-gray-400 mb-1">Game Port</label><input type="number" className="w-full bg-gray-800 border border-gray-600 rounded p-2 text-white" value={config.port} onChange={(e) => setConfig({...config, port: parseInt(e.target.value)})} /></div>
          <div><label className="block text-sm text-gray-400 mb-1">RCON Port</label><input type="number" className="w-full bg-gray-800 border border-gray-600 rounded p-2 text-white" value={config.rconPort} onChange={(e) => setConfig({...config, rconPort: parseInt(e.target.value)})} /></div>
          <div className="col-span-2"><label className="block text-sm text-gray-400 mb-1">RCON Password</label><input type="password" className="w-full bg-gray-800 border border-gray-600 rounded p-2 text-white" value={config.password} onChange={(e) => setConfig({...config, password: e.target.value})} /></div>
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between bg-gray-800 p-4 rounded border border-gray-600">
          <div className="flex items-center gap-3">
            <span className="text-2xl">{EMOJI.ZAP}</span>
            <div>
              <div className="font-bold text-white">Auto-Connect on Startup</div>
              <div className="text-xs text-gray-400">Automatically connect to the server when the app starts.</div>
            </div>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input type="checkbox" className="sr-only peer" checked={config.autoConnect} onChange={(e) => setConfig({...config, autoConnect: e.target.checked})} />
            <div className="w-11 h-6 bg-gray-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-yellow-600"></div>
          </label>
        </div>
      </section>

      <section>
        <h2 className="text-xl font-bold text-white mb-4 border-b border-gray-700 pb-2">{t('settings.steam')}</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Steam Web API Key</label>
            <input type="text" className="w-full bg-gray-800 border border-gray-600 rounded p-2 text-white" placeholder="XXXXXXXXXXXXXXXXXXXX" value={config.steamApiKey} onChange={(e) => setConfig({...config, steamApiKey: e.target.value})} />
            <p className="text-xs text-gray-500 mt-1">Required for VAC Ban checks and avatar fetching.</p>
          </div>
          <div className="flex items-center justify-between bg-gray-800 p-4 rounded border border-gray-600">
            <div className="flex items-center gap-3"><span className="text-2xl">{EMOJI.BAN}</span><div><div className="font-bold text-white">Auto-Ban VAC/Game Bans</div><div className="text-xs text-gray-400">Automatically ban players with VAC/Game bans.</div></div></div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" className="sr-only peer" checked={config.autoBan} onChange={(e) => setConfig({...config, autoBan: e.target.checked})} />
              <div className="w-11 h-6 bg-gray-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-red-600"></div>
            </label>
          </div>
        </div>
      </section>

      <section>
        <h2 className="text-xl font-bold text-white mb-4 border-b border-gray-700 pb-2">{t('settings.language')}</h2>
        <div className="flex gap-4">
          <button onClick={() => i18n.changeLanguage('en')} className={`px-4 py-2 rounded ${i18n.language === 'en' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300'}`}>English</button>
          <button onClick={() => i18n.changeLanguage('ja')} className={`px-4 py-2 rounded ${i18n.language === 'ja' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300'}`}>日本語</button>
        </div>
      </section>

      <div className="pt-4 pb-10">
        <button 
          onClick={() => handleToggleConnection()}
          className={`w-full py-3 font-bold rounded transition-colors flex items-center justify-center gap-2 ${
            connectionStatus === 'connected' ? 'bg-red-800 hover:bg-red-700 text-white' :
            connectionStatus === 'connecting' ? 'bg-yellow-600 hover:bg-yellow-700 text-white' :
            'bg-green-600 hover:bg-green-500 text-white'
          }`}
        >
          {connectionStatus === 'connected' ? (
            <>{EMOJI.DISCONNECT} Disconnect</>
          ) : connectionStatus === 'connecting' ? 'Cancel Connection' : 'Save & Connect'}
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen bg-gray-900 text-gray-100 overflow-hidden relative">
      {/* モーダル表示 */}
      {renderModal()}
      
      <aside className="w-64 bg-gray-950 flex flex-col border-r border-gray-800">
        <div className="p-4 flex items-center gap-2 border-b border-gray-800">
          <div className="w-8 h-8 bg-red-600 rounded flex items-center justify-center font-bold">R</div>
          <span className="font-bold text-lg tracking-wider">RUST RCON</span>
        </div>
        <nav className="flex-1 p-2 space-y-1">
          {[
            { id: 'console', label: t('tabs.console'), icon: EMOJI.TERMINAL },
            { id: 'players', label: t('tabs.players'), icon: EMOJI.PLAYERS },
            { id: 'banlist', label: t('tabs.banlist'), icon: EMOJI.BAN },
            { id: 'settings', label: t('tabs.settings'), icon: EMOJI.SETTINGS },
          ].map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id as any)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all ${
                activeTab === item.id 
                  ? 'bg-blue-600/20 text-blue-400 border border-blue-600/30' 
                  : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
              }`}
            >
              <span>{item.icon}</span>
              <span className="font-medium">{item.label}</span>
            </button>
          ))}
        </nav>
        
        <div className="p-2 border-t border-gray-800/50">
          <button 
            onClick={handleReconnect}
            className="w-full py-2 px-3 text-xs font-mono text-gray-400 hover:text-white hover:bg-gray-800 rounded transition-colors text-center border border-gray-700 hover:border-gray-500"
          >
            [ {EMOJI.ZAP} RECONNECT ]
          </button>
        </div>

        <div className="p-4 border-t border-gray-800">
          <div className="flex items-center gap-2 mb-2">
            <div className={`w-2 h-2 rounded-full ${
              connectionStatus === 'connected' ? 'bg-green-500 animate-pulse' : 
              connectionStatus === 'error' ? 'bg-red-500' : 
              connectionStatus === 'connecting' ? 'bg-yellow-500 animate-bounce' : 'bg-gray-500'
            }`}></div>
            <span className={`text-xs font-mono ${
              connectionStatus === 'connected' ? 'text-green-500' : 
              connectionStatus === 'error' ? 'text-red-500' : 'text-gray-500'
            }`}>
              {connectionStatus.toUpperCase()}
            </span>
          </div>
          <div className="text-xs text-gray-500 truncate">{config.serverName}</div>
          <div className="text-xs text-gray-600 font-mono">{config.ip}:{config.port}</div>
        </div>
      </aside>
      <main className="flex-1 bg-gray-900 relative">
        {activeTab === 'console' && renderConsole()}
        {activeTab === 'players' && renderPlayers()}
        {activeTab === 'banlist' && renderBanList()}
        {activeTab === 'settings' && renderSettings()}
      </main>
    </div>
  );
}

export default App;