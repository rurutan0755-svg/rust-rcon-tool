import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

const resources = {
  en: {
    translation: {
      tabs: { console: "Console", players: "Players", banlist: "Ban List", settings: "Settings" },
      players: {
        online: "Online Players",
        history: "Connection History",
        headers: { name: "Name", country: "Country/City", steamid: "SteamID", ip: "IP Address", ping: "Ping", total: "Total Time", session: "Session", actions: "Actions" },
        actions: { kick: "Kick", ban: "Ban", copyId: "Copy ID", copyIp: "Copy IP" }
      },
      settings: {
        connection: "Connection Settings",
        steam: "Steam API & Automations",
        language: "Language Settings",
        save: "Save Settings"
      }
    }
  },
  ja: {
    translation: {
      tabs: { console: "コンソール", players: "プレイヤー", banlist: "BANリスト", settings: "設定" },
      players: {
        online: "オンラインプレイヤー",
        history: "接続履歴 (ログアウト済み)",
        headers: { name: "名前", country: "国/都市", steamid: "SteamID", ip: "IPアドレス", ping: "Ping", total: "合計時間", session: "接続時間", actions: "操作" },
        actions: { kick: "キック", ban: "BAN", copyId: "IDコピー", copyIp: "IPコピー" }
      },
      settings: {
        connection: "接続設定",
        steam: "Steam API & 自動化",
        language: "言語設定",
        save: "設定を保存"
      }
    }
  }
};

i18n.use(initReactI18next).init({
  resources,
  lng: "en", // デフォルトは英語
  interpolation: { escapeValue: false }
});

export default i18n;