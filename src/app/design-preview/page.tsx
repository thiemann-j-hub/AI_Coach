'use client';

import React from 'react';
import { useTheme } from 'next-themes';

export default function DesignPreviewPage() {
  const { theme, setTheme } = useTheme();

  const toggleTheme = () => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  };

  return (
    <div className="flex flex-col md:flex-row h-screen overflow-hidden bg-background-light dark:bg-background-dark text-text-main-light dark:text-text-main-dark font-body antialiased selection:bg-primary selection:text-white transition-colors duration-300">
      
      {/* Mobile Header */}
      <div className="md:hidden flex items-center justify-between p-4 bg-surface-light dark:bg-surface-dark border-b border-border-light dark:border-border-dark">
        <div className="font-bold text-xl text-primary">PulseCraft AI</div>
        <button className="text-text-main-light dark:text-text-main-dark">
          <span className="material-icons-round">menu</span>
        </button>
      </div>

      {/* Sidebar */}
      <aside className="hidden md:flex flex-col w-64 h-full bg-surface-light dark:bg-surface-dark border-r border-border-light dark:border-border-dark flex-shrink-0 z-20">
        <div className="p-6">
          <h1 className="font-display font-bold text-2xl tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-primary to-blue-400">
            PulseCraft AI
          </h1>
        </div>
        <nav className="flex-1 px-4 space-y-2 overflow-y-auto">
          <a href="#" className="flex items-center px-4 py-3 bg-primary/10 text-primary rounded-lg border-l-4 border-primary transition-all duration-200 group">
            <span className="material-icons-round mr-3">analytics</span>
            <span className="font-medium">Analyse</span>
          </a>
          <a href="#" className="flex items-center px-4 py-3 text-text-muted-light dark:text-text-muted-dark hover:text-text-main-light dark:hover:text-text-main-dark hover:bg-gray-100 dark:hover:bg-white/5 rounded-lg transition-all duration-200 group">
            <span className="material-icons-round mr-3 group-hover:scale-110 transition-transform">history</span>
            <span className="font-medium">Verlauf</span>
          </a>
          <a href="#" className="flex items-center px-4 py-3 text-text-muted-light dark:text-text-muted-dark hover:text-text-main-light dark:hover:text-text-main-dark hover:bg-gray-100 dark:hover:bg-white/5 rounded-lg transition-all duration-200 group">
            <span className="material-icons-round mr-3 group-hover:scale-110 transition-transform">grid_view</span>
            <span className="font-medium">Design-Preview</span>
          </a>
        </nav>
        <div className="p-4 mt-auto">
          <button className="w-full btn-gradient text-white font-semibold py-3 px-4 rounded-xl flex items-center justify-center gap-2 shadow-glow">
            <span className="material-icons-round text-xl">add_circle_outline</span>
            Neue Analyse
          </button>
        </div>
        <div className="px-4 pb-4">
          <button 
            className="flex items-center justify-center w-full py-2 text-xs text-text-muted-light dark:text-text-muted-dark hover:bg-gray-100 dark:hover:bg-white/5 rounded transition-colors"
            onClick={toggleTheme}
          >
            <span className="material-icons-round text-base mr-2">brightness_6</span> Toggle Theme
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-full overflow-hidden relative">
        <header className="h-16 flex items-center justify-between px-6 bg-background-light dark:bg-background-dark border-b border-border-light dark:border-border-dark flex-shrink-0">
          <div className="flex flex-col">
            <h2 className="text-lg font-bold text-text-main-light dark:text-text-main-dark leading-tight">Analyse</h2>
            <span className="text-xs text-text-muted-light dark:text-text-muted-dark font-mono">Session: 05811cad-a2e9-4fc6...</span>
          </div>
          <div className="flex items-center space-x-4">
            <button className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-light dark:bg-surface-dark border border-border-light dark:border-border-dark text-text-muted-light dark:text-text-muted-dark text-sm hover:border-primary transition-colors">
              <span className="material-icons-round text-sm">history</span>
              <span>Verlauf</span>
            </button>
            <button className="relative p-2 text-text-muted-light dark:text-text-muted-dark hover:text-primary transition-colors">
              <span className="material-icons-round">notifications</span>
              <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-primary rounded-full border-2 border-background-light dark:border-background-dark"></span>
            </button>
            <div className="flex items-center pl-4 border-l border-border-light dark:border-border-dark">
              <div className="text-right mr-3 hidden sm:block">
                <div className="text-sm font-semibold text-text-main-light dark:text-text-main-dark">Jürgen Thiemann</div>
                <div className="text-xs text-text-muted-light dark:text-text-muted-dark cursor-pointer hover:text-primary">Logout</div>
              </div>
              <div className="relative">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-indigo-500 flex items-center justify-center text-white font-bold shadow-md">
                  J
                </div>
                <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 border-2 border-background-light dark:border-background-dark rounded-full"></div>
              </div>
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-6 scroll-smooth">
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 max-w-8xl mx-auto h-full">
            {/* Left Column */}
            <div className="xl:col-span-2 flex flex-col gap-6">
              <div className="bg-surface-light dark:bg-surface-dark rounded-DEFAULT shadow-card-light dark:shadow-card-dark p-6 border border-border-light dark:border-border-dark h-full flex flex-col">
                <div className="mb-4">
                  <h3 className="text-xl font-semibold text-text-main-light dark:text-text-main-dark mb-1">Transkript</h3>
                  <p className="text-sm text-text-muted-light dark:text-text-muted-dark">PDF hochladen oder Text einfügen</p>
                </div>
                
                {/* PDF Import Box */}
                <div className="bg-background-light dark:bg-[#0d1f38] rounded-xl p-5 mb-5 border border-border-light dark:border-border-dark">
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4 gap-4">
                    <div>
                      <h4 className="font-bold text-text-main-light dark:text-text-main-dark">PDF importieren</h4>
                      <p className="text-xs text-text-muted-light dark:text-text-muted-dark mt-1">max. 30 Seiten · max. 250k Zeichen</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="relative">
                        <select className="appearance-none bg-surface-light dark:bg-surface-dark border border-border-light dark:border-border-dark text-text-main-light dark:text-text-main-dark text-sm rounded-lg px-3 py-2 pr-8 focus:ring-2 focus:ring-primary focus:border-transparent outline-none cursor-pointer">
                          <option>Ersetzen</option>
                          <option>Anhängen</option>
                        </select>
                        <span className="material-icons-round absolute right-2 top-2.5 text-text-muted-light dark:text-text-muted-dark text-sm pointer-events-none">expand_more</span>
                      </div>
                      <label className="flex items-center gap-2 cursor-pointer select-none">
                        <input type="checkbox" defaultChecked className="form-checkbox text-primary rounded border-border-light dark:border-border-dark bg-surface-light dark:bg-surface-dark focus:ring-offset-background-dark focus:ring-primary h-4 w-4" />
                        <span className="text-xs font-medium text-text-main-light dark:text-text-main-dark">Teams bereinigen</span>
                      </label>
                      <button className="bg-transparent border border-primary text-primary hover:bg-primary hover:text-white transition-colors text-xs font-medium py-2 px-4 rounded-lg">
                        PDF hochladen
                      </button>
                    </div>
                  </div>
                  <div className="border-2 border-dashed border-border-light dark:border-[#233554] bg-surface-light/50 dark:bg-white/5 rounded-xl p-8 flex flex-col items-center justify-center text-center transition-all hover:border-primary/50 group cursor-pointer">
                    <span className="material-icons-round text-3xl text-text-muted-light dark:text-text-muted-dark mb-2 group-hover:text-primary transition-colors">cloud_upload</span>
                    <span className="font-semibold text-text-main-light dark:text-text-main-dark">Drag & Drop</span>
                    <span className="text-sm text-text-muted-light dark:text-text-muted-dark mt-1">Ziehe eine Teams-PDF hier rein oder nutze den Button.</span>
                  </div>
                </div>

                {/* Toolbar */}
                <div className="flex flex-wrap gap-2 mb-4">
                  <button className="flex items-center gap-2 px-3 py-2 bg-surface-light dark:bg-[#1C2C4E] hover:bg-gray-200 dark:hover:bg-[#253961] text-text-muted-light dark:text-text-muted-dark rounded-lg text-sm transition-colors">
                    <span className="material-symbols-rounded text-lg text-primary">auto_fix_high</span>
                    Teams bereinigen
                  </button>
                  <button className="flex items-center gap-2 px-3 py-2 bg-surface-light dark:bg-[#1C2C4E] hover:bg-gray-200 dark:hover:bg-[#253961] text-text-muted-light dark:text-text-muted-dark rounded-lg text-sm transition-colors">
                    <span className="material-symbols-rounded text-lg">security</span>
                    Anonymisieren
                  </button>
                  <button className="flex items-center gap-2 px-3 py-2 bg-surface-light dark:bg-[#1C2C4E] hover:bg-gray-200 dark:hover:bg-[#253961] text-text-muted-light dark:text-text-muted-dark rounded-lg text-sm transition-colors ml-auto">
                    <span className="material-symbols-rounded text-lg">undo</span>
                    Undo
                  </button>
                  <button className="flex items-center gap-2 px-3 py-2 bg-surface-light dark:bg-[#1C2C4E] hover:bg-gray-200 dark:hover:bg-[#253961] text-text-muted-light dark:text-text-muted-dark rounded-lg text-sm transition-colors hover:text-red-400">
                    <span className="material-symbols-rounded text-lg">delete</span>
                    Clear
                  </button>
                </div>

                {/* Text Area */}
                <div className="flex-1 relative">
                  <textarea 
                    className="w-full h-full bg-background-light dark:bg-[#0A192F] text-text-main-light dark:text-text-main-dark placeholder-text-muted-light dark:placeholder-text-muted-dark/50 border border-border-light dark:border-border-dark rounded-xl p-4 text-base leading-relaxed focus:ring-2 focus:ring-primary focus:border-transparent outline-none resize-none min-h-[300px]" 
                    placeholder="Hier steht nach dem PDF-Upload der Text... oder du fügst ihn manuell ein."
                  ></textarea>
                  <div className="absolute bottom-2 right-2 text-text-muted-light dark:text-text-muted-dark opacity-50">
                    <span className="material-icons-round text-sm transform rotate-45">open_in_full</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Right Column - Settings */}
            <div className="flex flex-col gap-6">
              <div className="bg-surface-light dark:bg-surface-dark rounded-DEFAULT shadow-card-light dark:shadow-card-dark p-6 border border-border-light dark:border-border-dark">
                <h3 className="text-lg font-bold text-text-main-light dark:text-text-main-dark mb-5">Einstellungen</h3>
                <div className="space-y-6">
                  <div>
                    <label className="block text-xs font-medium text-text-muted-light dark:text-text-muted-dark uppercase tracking-wide mb-2">Sprache</label>
                    <div className="relative">
                      <select className="w-full appearance-none bg-background-light dark:bg-[#0d1f38] border border-border-light dark:border-border-dark text-text-main-light dark:text-text-main-dark rounded-lg px-4 py-3 pr-8 focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-shadow">
                        <option>Deutsch</option>
                        <option>English</option>
                        <option>Español</option>
                      </select>
                      <span className="material-icons-round absolute right-3 top-3.5 text-text-muted-light dark:text-text-muted-dark pointer-events-none">expand_more</span>
                    </div>
                    <p className="text-[11px] text-text-muted-light dark:text-text-muted-dark mt-2 leading-tight">
                      (Deutsch/Englisch ist vorbereitet – Logik kann später erweitert werden.)
                    </p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-text-muted-light dark:text-text-muted-dark uppercase tracking-wide mb-2">Ziel (optional)</label>
                    <input 
                      type="text" 
                      className="w-full bg-background-light dark:bg-[#0d1f38] border border-border-light dark:border-border-dark text-text-main-light dark:text-text-main-dark rounded-lg px-4 py-3 placeholder-text-muted-light dark:placeholder-text-muted-dark focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-shadow" 
                      placeholder="z.B. klar und fair, ohne Eskalation" 
                    />
                  </div>
                  <div className="p-4 rounded-xl border border-border-light dark:border-border-dark bg-background-light/50 dark:bg-[#0d1f38]/50">
                    <span className="block text-xs font-medium text-text-muted-light dark:text-text-muted-dark mb-1">Gesprächsart</span>
                    <div className="font-bold text-text-main-light dark:text-text-main-dark mb-1">Mitarbeitendengespräch</div>
                    <p className="text-xs text-text-muted-light dark:text-text-muted-dark leading-snug">
                      (Conversation-Type ist aktuell technisch fix, damit RAG stabil bleibt.)
                    </p>
                  </div>
                </div>
              </div>

              <div className="bg-surface-light dark:bg-surface-dark rounded-DEFAULT shadow-card-light dark:shadow-card-dark p-6 border border-border-light dark:border-border-dark flex-1">
                <div className="flex items-center gap-2 mb-4">
                  <h3 className="text-lg font-bold text-text-main-light dark:text-text-main-dark">Rollen im Gespräch</h3>
                </div>
                <p className="text-sm text-text-muted-light dark:text-text-muted-dark mb-5 leading-relaxed">
                  Wähle die Führungskraft (Mitarbeitende wird automatisch gesetzt)
                </p>
                <div className="space-y-6">
                  <div>
                    <label className="block text-xs font-medium text-text-muted-light dark:text-text-muted-dark uppercase tracking-wide mb-2">Führungskraft (Ich)</label>
                    <div className="relative">
                      <select className="w-full appearance-none bg-background-light dark:bg-[#0d1f38] border border-border-light dark:border-border-dark text-text-main-light dark:text-text-main-dark rounded-lg px-4 py-3 pr-8 focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-shadow">
                        <option>Transkript einfügen...</option>
                      </select>
                      <span className="material-icons-round absolute right-3 top-3.5 text-text-muted-light dark:text-text-muted-dark pointer-events-none">expand_more</span>
                    </div>
                    <p className="text-[11px] text-text-muted-light dark:text-text-muted-dark mt-2">
                      Tipp: Nach Upload/Einfügen werden Sprecher automatisch erkannt.
                    </p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-text-muted-light dark:text-text-muted-dark uppercase tracking-wide mb-2">Mitarbeitende</label>
                    <div className="w-full bg-background-light dark:bg-[#0d1f38] border border-border-light dark:border-border-dark text-text-muted-light dark:text-text-muted-dark rounded-lg px-4 py-3 opacity-70">
                      wähle zuerst die Führungskraft...
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}