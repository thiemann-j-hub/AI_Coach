'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { authFetch } from '@/lib/api-client';
import { auth } from '@/lib/firebaseClient';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface LinkedInPostCardProps {
  summary: string;
  strengths: string[];
  improvements: string[];
  scoreOverall: number | null;
  conversationType: string;
  lang: string;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function LinkedInPostCard({
  summary,
  strengths,
  improvements,
  scoreOverall,
  conversationType,
  lang,
}: LinkedInPostCardProps) {
  const { t } = useTranslation();

  // State
  const [linkedInName, setLinkedInName] = useState<string | null>(null);
  const [postText, setPostText] = useState('');
  const [headline, setHeadline] = useState('');
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [imageMimeType, setImageMimeType] = useState('image/png');

  const [isGeneratingPost, setIsGeneratingPost] = useState(false);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [isPosting, setIsPosting] = useState(false);

  const [postError, setPostError] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [postSuccess, setPostSuccess] = useState<string | null>(null);

  const [configured, setConfigured] = useState<boolean | null>(null);
  const [connectNotice, setConnectNotice] = useState<{ kind: 'ok' | 'error'; detail?: string } | null>(null);
  const [tokenExpiredHint, setTokenExpiredHint] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Verbindungsstatus kommt aus Firestore (per /status), nicht mehr aus
  // Cookies — erst abfragen, wenn Firebase-Auth initialisiert ist, sonst
  // fehlt der Authorization-Header und die Card zeigt faelschlich "nicht
  // verbunden" (z.B. direkt nach dem OAuth-Redirect).
  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(() => {
      authFetch('/api/linkedin/status')
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => {
          if (!j) {
            setConfigured(null);
            return;
          }
          setConfigured(!!j.configured);
          setLinkedInName(j.connected ? (j.name || 'LinkedIn') : null);
          setTokenExpiredHint(!!j.expired);
        })
        .catch(() => setConfigured(null));
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    // OAuth-Callback-Ergebnis aus den Query-Params lesen und URL bereinigen
    try {
      const params = new URLSearchParams(window.location.search);
      const connected = params.get('linkedin_connected');
      const err = params.get('linkedin_error');
      if (connected || err) {
        setConnectNotice(err ? { kind: 'error', detail: err } : { kind: 'ok' });
        params.delete('linkedin_connected');
        params.delete('linkedin_error');
        const qs = params.toString();
        window.history.replaceState(null, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
      }
    } catch {}
  }, []);

  const isConnected = !!linkedInName;

  /* ---- Generate Post Text ---- */
  const handleGeneratePost = useCallback(async () => {
    setIsGeneratingPost(true);
    setPostError(null);
    try {
      const res = await authFetch('/api/linkedin/generate-post', {
        method: 'POST',
        body: JSON.stringify({
          summary,
          strengths,
          improvements,
          scoreOverall,
          conversationType,
          lang,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? 'Failed');
      setPostText(data.postText ?? '');
      setHeadline(data.headline ?? '');
    } catch (err: any) {
      setPostError(err?.message ?? 'Unknown error');
    } finally {
      setIsGeneratingPost(false);
    }
  }, [summary, strengths, improvements, scoreOverall, conversationType, lang]);

  /* ---- Generate Image ---- */
  const handleGenerateImage = useCallback(async () => {
    if (!headline && !postText) {
      setImageError(t.linkedin.generatePostFirst);
      return;
    }
    setIsGeneratingImage(true);
    setImageError(null);
    try {
      const res = await authFetch('/api/linkedin/generate-image', {
        method: 'POST',
        body: JSON.stringify({
          headline: headline || postText.slice(0, 100),
          topic: summary.slice(0, 300),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? 'Failed');
      setImageBase64(data.imageBase64);
      setImageMimeType(data.mimeType ?? 'image/png');
    } catch (err: any) {
      setImageError(err?.message ?? 'Unknown error');
    } finally {
      setIsGeneratingImage(false);
    }
  }, [headline, postText, summary, t]);

  /* ---- Post to LinkedIn ---- */
  const handlePostToLinkedIn = useCallback(async () => {
    if (!postText) return;
    setIsPosting(true);
    setPostError(null);
    setPostSuccess(null);
    try {
      const res = await authFetch('/api/linkedin/post', {
        method: 'POST',
        body: JSON.stringify({
          text: postText,
          imageBase64: imageBase64 ?? undefined,
          imageMimeType,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data?.tokenExpired) {
          setLinkedInName(null);
          throw new Error(t.linkedin.tokenExpired);
        }
        throw new Error(data?.error ?? 'Failed');
      }
      setPostSuccess(data.postUrl ?? t.linkedin.posted);
    } catch (err: any) {
      setPostError(err?.message ?? 'Unknown error');
    } finally {
      setIsPosting(false);
    }
  }, [postText, imageBase64, imageMimeType, t]);

  /* ---- Connect to LinkedIn ---- */
  // POST mit Firebase-Auth statt GET-Navigation: der Server bindet den
  // OAuth-state an die uid und liefert die Auth-URL zurueck (LI-E3)
  const handleConnect = useCallback(async () => {
    setIsConnecting(true);
    setConnectNotice(null);
    try {
      const returnTo = window.location.pathname + window.location.search;
      const res = await authFetch('/api/linkedin/auth', {
        method: 'POST',
        body: JSON.stringify({ returnTo }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.authUrl) {
        throw new Error(data?.error ?? `HTTP ${res.status}`);
      }
      window.location.href = data.authUrl;
      // isConnecting bleibt true — die Seite navigiert weg
    } catch (err: any) {
      setConnectNotice({ kind: 'error', detail: err?.message ?? 'Unknown error' });
      setIsConnecting(false);
    }
  }, []);

  /* ------------------------------------------------------------------ */
  /*  Render                                                             */
  /* ------------------------------------------------------------------ */

  return (
    <div className="glass-panel rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="p-5 border-b border-border bg-foreground/[0.02] flex items-center gap-3">
        <div className="p-2 rounded-lg bg-[#0A66C2]/10 text-[#0A66C2]">
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
          </svg>
        </div>
        <div className="flex-1">
          <h3 className="font-bold text-lg text-foreground">{t.linkedin.title}</h3>
          <p className="text-xs text-muted-foreground">{t.linkedin.subtitle}</p>
        </div>
        {isConnected && (
          <span className="text-xs text-emerald-500 font-medium flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
            {linkedInName}
          </span>
        )}
      </div>

      <div className="p-5 space-y-5">
        {/* Step 1: Generate Post */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              {t.linkedin.step1}
            </span>
            <button
              type="button"
              onClick={handleGeneratePost}
              disabled={isGeneratingPost}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary text-white hover:bg-primary/90 disabled:opacity-50 transition-all flex items-center gap-1.5"
            >
              {isGeneratingPost ? (
                <>
                  <span className="animate-spin inline-block w-3 h-3 border-2 border-white/30 border-t-white rounded-full" />
                  {t.linkedin.generating}
                </>
              ) : (
                <>
                  <span className="material-icons-round text-sm">auto_awesome</span>
                  {t.linkedin.generatePost}
                </>
              )}
            </button>
          </div>

          <textarea
            value={postText}
            onChange={(e) => setPostText(e.target.value)}
            placeholder={t.linkedin.postPlaceholder}
            rows={6}
            className="w-full rounded-xl border border-border bg-background/60 p-3 text-sm text-foreground placeholder:text-muted-foreground/50 focus:ring-1 focus:ring-primary focus:border-primary resize-y"
          />

          {headline && (
            <div className="mt-2">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider block mb-1">
                {t.linkedin.imageHeadline}
              </label>
              <input
                type="text"
                value={headline}
                onChange={(e) => setHeadline(e.target.value)}
                className="w-full rounded-lg border border-border bg-background/60 px-3 py-2 text-sm text-foreground focus:ring-1 focus:ring-primary focus:border-primary"
              />
            </div>
          )}
        </div>

        {/* Step 2: Generate Image */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              {t.linkedin.step2}
            </span>
            <button
              type="button"
              onClick={handleGenerateImage}
              disabled={isGeneratingImage || (!headline && !postText)}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-secondary text-foreground border border-border hover:bg-primary/10 disabled:opacity-50 transition-all flex items-center gap-1.5"
            >
              {isGeneratingImage ? (
                <>
                  <span className="animate-spin inline-block w-3 h-3 border-2 border-primary/30 border-t-primary rounded-full" />
                  {t.linkedin.generatingImage}
                </>
              ) : (
                <>
                  <span className="material-icons-round text-sm">image</span>
                  {t.linkedin.generateImage}
                </>
              )}
            </button>
          </div>

          {imageBase64 ? (
            <div className="relative rounded-xl overflow-hidden border border-border">
              <img
                src={`data:${imageMimeType};base64,${imageBase64}`}
                alt="Generated LinkedIn post image"
                className="w-full object-cover"
              />
              <button
                type="button"
                onClick={handleGenerateImage}
                disabled={isGeneratingImage}
                className="absolute bottom-2 right-2 px-2 py-1 rounded-lg text-[10px] font-semibold bg-black/60 text-white hover:bg-black/80 transition"
              >
                {t.linkedin.regenerate}
              </button>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-border bg-foreground/[0.02] p-8 text-center">
              <span className="material-icons-round text-3xl text-muted-foreground/30">image</span>
              <p className="text-xs text-muted-foreground mt-2">{t.linkedin.noImage}</p>
            </div>
          )}
        </div>

        {/* Connect result (OAuth-Callback) */}
        {connectNotice && (
          <div
            className={`p-3 rounded-xl text-sm border ${
              connectNotice.kind === 'ok'
                ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                : 'bg-red-500/10 border-red-500/20 text-red-400'
            }`}
          >
            {connectNotice.kind === 'ok'
              ? t.linkedin.connectedOk
              : `${t.linkedin.connectFailed} ${connectNotice.detail ?? ''}`}
          </div>
        )}

        {/* Token abgelaufen -> Reconnect-Hinweis (LI-E3) */}
        {tokenExpiredHint && !isConnected && (
          <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-sm text-amber-400">
            {t.linkedin.tokenExpired}
          </div>
        )}

        {/* Errors */}
        {(postError || imageError) && (
          <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-sm text-red-400">
            {postError || imageError}
          </div>
        )}

        {/* Success */}
        {postSuccess && (
          <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-sm text-emerald-400">
            {t.linkedin.posted}{' '}
            {postSuccess.startsWith('http') && (
              <a
                href={postSuccess}
                target="_blank"
                rel="noopener noreferrer"
                className="underline font-medium"
              >
                {t.linkedin.viewPost}
              </a>
            )}
          </div>
        )}

        {/* Step 3: Post to LinkedIn */}
        <div className="pt-2 border-t border-border">
          {isConnected ? (
            confirmOpen ? (
              // Bestätigungs-Stufe: Publish ist outward-facing und sofort PUBLIC
              <div className="space-y-3">
                <p className="text-sm font-medium text-foreground text-center">
                  {t.linkedin.confirmQuestion}
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirmOpen(false)}
                    className="flex-1 py-3 rounded-xl text-sm font-semibold border border-border bg-secondary text-foreground hover:bg-foreground/10 transition-colors"
                  >
                    {t.common.cancel}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setConfirmOpen(false);
                      void handlePostToLinkedIn();
                    }}
                    className="flex-1 py-3 rounded-xl text-sm font-bold bg-[#0A66C2] text-white hover:bg-[#004182] transition-all"
                  >
                    {t.linkedin.confirmNow}
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmOpen(true)}
                disabled={isPosting || !postText}
                className="w-full py-3 rounded-xl text-sm font-bold bg-[#0A66C2] text-white hover:bg-[#004182] disabled:opacity-50 transition-all flex items-center justify-center gap-2"
              >
                {isPosting ? (
                  <>
                    <span className="animate-spin inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full" />
                    {t.linkedin.posting}
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
                    </svg>
                    {t.linkedin.postToLinkedIn}
                  </>
                )}
              </button>
            )
          ) : configured === false ? (
            <div className="p-3 rounded-xl bg-foreground/5 border border-border text-sm text-muted-foreground text-center">
              {t.linkedin.notConfigured}
            </div>
          ) : (
            <button
              type="button"
              onClick={handleConnect}
              disabled={isConnecting}
              className="w-full py-3 rounded-xl text-sm font-bold bg-[#0A66C2] text-white hover:bg-[#004182] disabled:opacity-50 transition-all flex items-center justify-center gap-2"
            >
              {isConnecting ? (
                <span className="animate-spin inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full" />
              ) : (
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
                </svg>
              )}
              {t.linkedin.connect}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
