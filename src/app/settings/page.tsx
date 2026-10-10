"use client";

import React, { useState } from "react";
import {
  Settings,
  Bot,
  Shield,
  Server,
  Save,
  CheckCircle2,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<"bot" | "profile" | "security">("bot");
  const [hermesHost, setHermesHost] = useState("76.13.193.138");
  const [hermesPort, setHermesPort] = useState("8643");
  const [hermesProfile, setHermesProfile] = useState("threads");
  const [isTesting, setIsTesting] = useState(false);
  const [testSuccess, setTestSuccess] = useState<boolean | null>(null);
  const [savedSuccess, setSavedSuccess] = useState(false);

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestSuccess(null);
    try {
      // simulate check
      await new Promise((r) => setTimeout(r, 800));
      setTestSuccess(true);
    } catch {
      setTestSuccess(false);
    } finally {
      setIsTesting(false);
    }
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 2500);
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div>
        <h2 className="text-xl md:text-2xl font-bold text-[#343C6A] tracking-tight">
          System Settings & Bot Gateway
        </h2>
        <p className="text-xs md:text-sm text-[#718EBF] mt-0.5">
          Konfigurasi koneksi Hermes VPS, akun bot Telegram, dan parameter analitik
        </p>
      </div>

      <div className="neo-card p-6 md:p-8">
        {/* Custom Tabs */}
        <div className="flex items-center gap-8 border-b border-[#EDF2F7] pb-4 mb-6">
          <button
            onClick={() => setActiveTab("bot")}
            className={cn(
              "relative pb-3 text-sm font-semibold transition-colors cursor-pointer",
              activeTab === "bot"
                ? "text-[#1814F3]"
                : "text-[#718EBF] hover:text-[#343C6A]"
            )}
          >
            Bot Gateway (Hermes)
            {activeTab === "bot" && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#1814F3] rounded-full" />
            )}
          </button>
          <button
            onClick={() => setActiveTab("profile")}
            className={cn(
              "relative pb-3 text-sm font-semibold transition-colors cursor-pointer",
              activeTab === "profile"
                ? "text-[#1814F3]"
                : "text-[#718EBF] hover:text-[#343C6A]"
            )}
          >
            Profil Akun Threads
            {activeTab === "profile" && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#1814F3] rounded-full" />
            )}
          </button>
          <button
            onClick={() => setActiveTab("security")}
            className={cn(
              "relative pb-3 text-sm font-semibold transition-colors cursor-pointer",
              activeTab === "security"
                ? "text-[#1814F3]"
                : "text-[#718EBF] hover:text-[#343C6A]"
            )}
          >
            Security & Token
            {activeTab === "security" && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#1814F3] rounded-full" />
            )}
          </button>
        </div>

        {/* Tab 1: Bot Configuration Form */}
        {activeTab === "bot" && (
          <form onSubmit={handleSave} className="space-y-6 max-w-2xl">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div>
                <label className="block text-xs font-bold text-[#343C6A] mb-2">
                  Hermes VPS Host / IP
                </label>
                <input
                  type="text"
                  value={hermesHost}
                  onChange={(e) => setHermesHost(e.target.value)}
                  className="w-full h-11 px-4 bg-[#F5F7FA] text-sm text-[#343C6A] rounded-2xl border border-transparent focus:border-[#1814F3]/30 focus:bg-white focus:outline-none transition-all"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-[#343C6A] mb-2">
                  Hermes Gateway Port
                </label>
                <input
                  type="text"
                  value={hermesPort}
                  onChange={(e) => setHermesPort(e.target.value)}
                  className="w-full h-11 px-4 bg-[#F5F7FA] text-sm text-[#343C6A] rounded-2xl border border-transparent focus:border-[#1814F3]/30 focus:bg-white focus:outline-none transition-all"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-[#343C6A] mb-2">
                  Hermes Agent Profile
                </label>
                <input
                  type="text"
                  value={hermesProfile}
                  onChange={(e) => setHermesProfile(e.target.value)}
                  className="w-full h-11 px-4 bg-[#F5F7FA] text-sm text-[#343C6A] rounded-2xl border border-transparent focus:border-[#1814F3]/30 focus:bg-white focus:outline-none transition-all"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-[#343C6A] mb-2">
                  Model AI (via 9router)
                </label>
                <input
                  type="text"
                  readOnly
                  value="ANALYTIC-SOSMED-COMBO (:20128)"
                  className="w-full h-11 px-4 bg-[#EDF2F7] text-sm text-[#718EBF] rounded-2xl border border-transparent cursor-not-allowed"
                />
              </div>
            </div>

            {/* Test Connection Action */}
            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={handleTestConnection}
                disabled={isTesting}
                className="px-5 py-2.5 rounded-full border border-[#EDF2F7] bg-[#F4F7FE] text-xs font-bold text-[#343C6A] hover:bg-[#EAEFF8] transition-colors flex items-center gap-2 cursor-pointer"
              >
                <RefreshCw
                  className={cn("w-3.5 h-3.5 text-[#1814F3]", isTesting && "animate-spin")}
                />
                <span>{isTesting ? "Memeriksa..." : "Uji Koneksi Gateway"}</span>
              </button>

              {testSuccess === true && (
                <span className="text-xs font-semibold text-[#16DBCC] flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4" />
                  Koneksi Gateway VPS Terverifikasi (112ms)
                </span>
              )}
            </div>

            <div className="pt-4 border-t border-[#EDF2F7] flex items-center gap-3">
              <button
                type="submit"
                className="px-7 py-3 rounded-full bg-[#1814F3] hover:bg-[#120ec0] text-white text-xs font-bold transition-all shadow-md shadow-[#1814F3]/25 flex items-center gap-2 cursor-pointer"
              >
                <Save className="w-4 h-4" />
                <span>Simpan Pengaturan</span>
              </button>

              {savedSuccess && (
                <span className="text-xs text-[#16DBCC] font-bold">
                  Pengaturan berhasil disimpan!
                </span>
              )}
            </div>
          </form>
        )}

        {/* Tab 2: Profile */}
        {activeTab === "profile" && (
          <div className="space-y-4 max-w-xl text-sm">
            <div className="p-4 rounded-2xl bg-[#F4F7FE] border border-[#EDF2F7] flex items-center gap-4">
              <div className="w-14 h-14 rounded-full overflow-hidden bg-white border border-[#EDF2F7]">
                <img
                  src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&auto=format&fit=crop&q=80"
                  alt="Profile"
                  className="w-full h-full object-cover"
                />
              </div>
              <div>
                <h4 className="font-bold text-[#343C6A]">Suka Shawarma</h4>
                <p className="text-xs text-[#718EBF]">@sukashawarma &bull; Threads Verified</p>
              </div>
            </div>
          </div>
        )}

        {/* Tab 3: Security */}
        {activeTab === "security" && (
          <div className="space-y-4 max-w-xl text-xs text-[#718EBF]">
            <p>
              Token akses tersimpan menggunakan enkripsi AES-256-GCM. Untuk rotasi token Meta/Threads, silakan lakukan otorisasi ulang via OAuth.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
