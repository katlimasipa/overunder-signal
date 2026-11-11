import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
  ArrowUpRight,
  Clock3,
  Disc3,
  Download,
  History,
  LayoutDashboard,
  Moon,
  Pause,
  Play,
  RotateCcw,
  Save,
  ShieldCheck,
  Square,
  Sun,
  TrendingUp,
  X,
} from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DerivCallback } from "@/components/deriv-callback";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DerivBot } from "@/lib/deriv-bot";
import { createDerivAuthorizationUrl } from "@/lib/deriv-oauth";
import {
  createPublicDerivSocket,
  DerivSocketClient,
  type DerivMessage,
  type DerivTick,
} from "@/lib/deriv-socket";
import { DERIV_MARKETS, type DerivAccount } from "@/lib/deriv-shared";
import { lastDigit, type StrategyTrade } from "@/lib/over-under-strategy";
import {
  createTradingSession,
  finishTradingSession,
  loadTradingHistory,
  MAX_SAVED_SESSIONS,
  MAX_SAVED_TRADES,
  saveTradingHistory,
  tradingHistoryCsv,
  updateTradingSessionTrade,
  type TradingSession,
  type TradingSessionStatus,
} from "@/lib/trading-history";

export const Route = createFileRoute("/")({
  validateSearch: z.object({
    code: z.string().optional(),
    state: z.string().optional(),
    error: z.string().optional(),
    error_description: z.string().optional(),
  }),
  head: () => ({
    meta: [
      { title: "OverUnderAuto — Strategy workspace" },
      {
        name: "description",
        content: "Live Deriv market feed, digit strategy controls, and account-level risk limits.",
      },
      { property: "og:title", content: "OverUnderAuto — Strategy workspace" },
      {
        property: "og:description",
        content: "A live market workspace for OverUnderAuto's digit strategy.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: IndexPage,
});

function IndexPage() {
  const search = Route.useSearch();
  if (search.code || search.error || search.error_description) return <DerivCallback />;
  return <Dashboard />;
}

type FeedPoint = { epoch: number; quote: number; pipSize: number; digit: number };
type FeedStatus = "connecting" | "live" | "reconnecting" | "unavailable";

const recoverySteps = [1, 1.5, 2, 3, 5];

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

function Dashboard() {
  const [isDark, setIsDark] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [botBusy, setBotBusy] = useState(false);
  const [symbol, setSymbol] = useState<string>("1HZ100V");
  const [stake, setStake] = useState("1.00");
  const [duration, setDuration] = useState("1");
  const [multiplier, setMultiplier] = useState(1.5);
  const [waitForFailedCycle, setWaitForFailedCycle] = useState(false);
  const [takeProfitEnabled, setTakeProfitEnabled] = useState(true);
  const [takeProfit, setTakeProfit] = useState("25.00");
  const [stopLossEnabled, setStopLossEnabled] = useState(true);
  const [stopLoss, setStopLoss] = useState("10.00");
  const [notifyEnabled, setNotifyEnabled] = useState(true);
  const [selectedTab, setSelectedTab] = useState("trades");
  const [selectedTradeSessionId, setSelectedTradeSessionId] = useState<string | null>(null);
  const [chartWindow, setChartWindow] = useState(60);
  const [accounts, setAccounts] = useState<DerivAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [authBusy, setAuthBusy] = useState(false);
  const [accountBusy, setAccountBusy] = useState(false);
  const [liveConfirmationOpen, setLiveConfirmationOpen] = useState(false);
  const [feedStatus, setFeedStatus] = useState<FeedStatus>("connecting");
  const [feed, setFeed] = useState<FeedPoint[]>([]);
  const [trades, setTrades] = useState<StrategyTrade[]>([]);
  const [sessions, setSessions] = useState<TradingSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [sessionPnl, setSessionPnl] = useState(0);
  const [lossStreak, setLossStreak] = useState(0);
  const [historyReady, setHistoryReady] = useState(false);
  const [historySaved, setHistorySaved] = useState(true);
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [iosInstallAvailable, setIosInstallAvailable] = useState(false);
  const [activeMobileSection, setActiveMobileSection] = useState("workspace");
  const [hasOpenTrade, setHasOpenTrade] = useState(false);
  const [notice, setNotice] = useState("");
  const publicSocketRef = useRef<DerivSocketClient | null>(null);
  const botSocketRef = useRef<DerivSocketClient | null>(null);
  const botRef = useRef<DerivBot | null>(null);
  const tradeRecordsRef = useRef<StrategyTrade[]>([]);
  const sessionRecordsRef = useRef<TradingSession[]>([]);
  const activeSessionIdRef = useRef<string | null>(null);
  const pendingSessionSaveIdRef = useRef<string | null>(null);
  const noticeTimerRef = useRef<number | null>(null);

  const selectedAccount =
    accounts.find((account) => account.accountId === selectedAccountId) ?? null;
  const market = DERIV_MARKETS.find((entry) => entry.symbol === symbol) ?? DERIV_MARKETS[4];
  const latestTick = feed.at(-1) ?? null;
  const visibleChartFeed = useMemo(() => {
    const cutoff = Math.floor(Date.now() / 1000) - chartWindow;
    return feed.filter((point) => point.epoch >= cutoff);
  }, [chartWindow, feed]);
  const chartPath = useMemo(() => makeChartPath(visibleChartFeed), [visibleChartFeed]);
  const currentSession = sessions.find((session) => session.id === currentSessionId) ?? null;
  const displayedSessionId = selectedTradeSessionId ?? currentSessionId;
  const currentSessionTrades = trades.filter((trade) => trade.sessionId === currentSessionId);
  const tradeLogTrades = displayedSessionId
    ? trades.filter((trade) => trade.sessionId === displayedSessionId)
    : [];
  const completedTrades = currentSessionTrades.filter((trade) => trade.status !== "Open");
  const wins = completedTrades.filter((trade) => trade.status === "Won").length;
  const losses = completedTrades.filter((trade) => trade.status === "Lost").length;
  const winRate = completedTrades.length
    ? `${((wins / completedTrades.length) * 100).toFixed(1)}%`
    : "—";
  const previousDigit = feed.at(-2)?.digit;
  const isLowDigit = latestTick?.digit === 0 || latestTick?.digit === 1;
  const previousWasLowDigit = previousDigit === 0 || previousDigit === 1;
  const currentSignal = waitForFailedCycle
    ? lossStreak > 0
      ? latestTick?.digit === 8 || latestTick?.digit === 9
        ? "Under 8 · failed cycle"
        : "Waiting for 8 or 9"
      : isLowDigit
        ? previousWasLowDigit
          ? "Over 1 · failure confirmed"
          : "Confirming failed cycle"
        : "Waiting for 0 or 1"
    : lossStreak > 0
      ? "Under 8 · recovery"
      : isLowDigit
        ? "Over 1 · entry"
        : "Waiting for 0 or 1";
  const botStatus = isRunning
    ? "Running"
    : hasOpenTrade
      ? "Finishing open trade"
      : botBusy
        ? "Connecting"
        : "Ready";

  function showNotice(message: string) {
    setNotice(message);
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => setNotice(""), 4200);
  }

  useEffect(
    () => () => {
      if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    themeColor?.setAttribute("content", isDark ? "#111315" : "#f7f8fa");
  }, [isDark]);

  useEffect(() => {
    const saved = loadTradingHistory();
    tradeRecordsRef.current = saved.trades;
    sessionRecordsRef.current = saved.sessions;
    setTrades(saved.trades);
    setSessions(saved.sessions);
    setCurrentSessionId(saved.currentSessionId);
    setSessionPnl(saved.sessionPnl);
    setLossStreak(saved.lossStreak);
    setHistoryReady(true);
  }, []);

  useEffect(() => {
    if (!historyReady) return;
    setHistorySaved(
      saveTradingHistory({ trades, sessions, currentSessionId, sessionPnl, lossStreak }),
    );
  }, [historyReady, trades, sessions, currentSessionId, sessionPnl, lossStreak]);

  useEffect(() => {
    const nav = navigator as Navigator & { standalone?: boolean };
    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches || nav.standalone === true;
    const isIos =
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    setIosInstallAvailable(isIos && !isStandalone);

    const captureInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", captureInstallPrompt);
    return () => window.removeEventListener("beforeinstallprompt", captureInstallPrompt);
  }, []);

  useEffect(() => {
    void fetch("/api/deriv/session", { credentials: "same-origin", cache: "no-store" })
      .then(async (response) => {
        if (!response.ok)
          throw new Error("Your Deriv session has expired. Connect again to continue.");
        const payload = (await response.json()) as { accounts?: DerivAccount[] };
        const nextAccounts = Array.isArray(payload.accounts) ? payload.accounts : [];
        setAccounts(nextAccounts);
        setSelectedAccountId((current) =>
          current && nextAccounts.some((account) => account.accountId === current)
            ? current
            : ((nextAccounts.find((account) => account.accountType === "demo") ?? nextAccounts[0])
                ?.accountId ?? ""),
        );
      })
      .catch((error: unknown) => {
        showNotice(error instanceof Error ? error.message : "Could not read your Deriv session.");
      })
      .finally(() => setAccountsLoading(false));
  }, []);

  useEffect(() => {
    let disposed = false;
    let reconnectTimer: number | null = null;
    let currentSocket: DerivSocketClient | null = null;
    setFeed([]);
    setFeedStatus("connecting");

    const connectFeed = () => {
      const client = createPublicDerivSocket();
      currentSocket = client;
      publicSocketRef.current = client;
      client.onTick((tick) => {
        const point = feedPoint(tick);
        if (!point || disposed) return;
        setFeed((current) =>
          current.at(-1)?.epoch === point.epoch ? current : [...current.slice(-79), point],
        );
        setFeedStatus("live");
      });
      client.onClose(() => {
        if (disposed) return;
        setFeedStatus("reconnecting");
        reconnectTimer = window.setTimeout(connectFeed, 2500);
      });

      void client
        .connect()
        .then(async () => {
          if (disposed) return;
          const history = await client.request({
            ticks_history: symbol,
            count: 40,
            end: "latest",
            style: "ticks",
          });
          const historical = historyPoints(history);
          if (historical.length && !disposed) setFeed(historical.slice(-80));
          await client.subscribeTicks(symbol);
          if (!disposed) setFeedStatus("live");
        })
        .catch(() => {
          if (disposed) return;
          setFeedStatus("unavailable");
          reconnectTimer = window.setTimeout(connectFeed, 3500);
        });
    };

    connectFeed();
    return () => {
      disposed = true;
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      currentSocket?.close();
      if (publicSocketRef.current === currentSocket) publicSocketRef.current = null;
    };
  }, [symbol]);

  async function beginDerivAuth(intent: "login" | "signup") {
    setAuthBusy(true);
    try {
      const url = await createDerivAuthorizationUrl(intent, window.location.origin);
      window.location.assign(url);
    } catch (error) {
      setAuthBusy(false);
      showNotice(error instanceof Error ? error.message : "Could not start Deriv sign-in.");
    }
  }

  async function disconnectDeriv() {
    if (isRunning || botBusy || hasOpenTrade) {
      showNotice("Pause the bot and let the open trade finish before disconnecting.");
      return;
    }
    setAccountBusy(true);
    try {
      await fetch("/api/deriv/session", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
      });
      setAccounts([]);
      setSelectedAccountId("");
      showNotice("Deriv account disconnected.");
    } finally {
      setAccountBusy(false);
    }
  }

  function closeSession(sessionId: string, status: Exclude<TradingSessionStatus, "running">) {
    sessionRecordsRef.current = finishTradingSession(sessionRecordsRef.current, sessionId, status);
    setSessions(sessionRecordsRef.current);
  }

  function saveCurrentSession() {
    if (botBusy) {
      showNotice("Wait for the bot connection to finish before saving the session.");
      return;
    }
    if (!currentSessionId || !currentSession) {
      showNotice("There is no session to save yet. Start the bot first.");
      return;
    }
    if (currentSession.status === "saved") {
      showNotice("This session is already saved in Session history.");
      return;
    }

    const runner = botRef.current;
    if (hasOpenTrade && !runner) {
      showNotice("The open contract must settle before this session can be saved.");
      return;
    }
    runner?.pause();
    setIsRunning(false);

    if (runner?.isBusy || hasOpenTrade) {
      pendingSessionSaveIdRef.current = currentSessionId;
      closeSession(currentSessionId, "saving");
      showNotice("Saving after the open contract settles. No new trades will start.");
      return;
    }

    closeSession(currentSessionId, "saved");
    if (runner) closeBotSocket(runner, botSocketRef.current);
    showNotice("Session saved to Session history.");
  }

  function resetSession() {
    if (isRunning || botBusy || hasOpenTrade || pendingSessionSaveIdRef.current) {
      showNotice("Stop the bot and let any open contract settle before resetting.");
      return;
    }
    if (currentSessionId) {
      setCurrentSessionId(null);
    }
    setSelectedTradeSessionId(null);
    setSelectedTab("trades");
    setSessionPnl(0);
    setLossStreak(0);
    showNotice("Session reset. Previous sessions remain in Session history.");
  }

  async function startBot() {
    if (!historyReady) {
      showNotice("Your saved trade history is still loading. Try again in a moment.");
      return;
    }
    if (!selectedAccount) {
      showNotice("Connect your Deriv account before starting the bot.");
      return;
    }
    if (botBusy) {
      showNotice("Wait for the open trade to settle before restarting.");
      return;
    }
    const baseStake = Number(stake);
    const takeProfitValue = takeProfitEnabled ? Number(takeProfit) : null;
    const stopLossValue = stopLossEnabled ? Number(stopLoss) : null;
    if (!Number.isFinite(baseStake) || baseStake < 0.35) {
      showNotice("Enter a base stake of at least $0.35.");
      return;
    }
    if (
      (takeProfitValue !== null && (!Number.isFinite(takeProfitValue) || takeProfitValue <= 0)) ||
      (stopLossValue !== null && (!Number.isFinite(stopLossValue) || stopLossValue <= 0))
    ) {
      showNotice("Enter a positive amount for each enabled risk limit.");
      return;
    }
    if (
      takeProfitValue !== null &&
      stopLossValue !== null &&
      takeProfitValue <= 0 &&
      stopLossValue <= 0
    ) {
      showNotice("At least one risk limit must be greater than zero.");
      return;
    }

    setBotBusy(true);
    let createdSessionId: string | null = null;
    try {
      const otpResponse = await fetch("/api/deriv/otp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        cache: "no-store",
        body: JSON.stringify({ accountId: selectedAccount.accountId }),
      });
      const otpPayload = (await otpResponse.json()) as { url?: string; error?: string };
      if (!otpResponse.ok || !otpPayload.url)
        throw new Error(otpPayload.error ?? "Could not connect to this Deriv account.");

      const socket = new DerivSocketClient(otpPayload.url);
      const newSession = createTradingSession(makeSessionId(), selectedAccount.currency);
      createdSessionId = newSession.id;
      activeSessionIdRef.current = newSession.id;
      sessionRecordsRef.current = [newSession, ...sessionRecordsRef.current].slice(
        0,
        MAX_SAVED_SESSIONS,
      );
      setSessions(sessionRecordsRef.current);
      setCurrentSessionId(newSession.id);
      setSelectedTradeSessionId(null);
      setSelectedTab("trades");
      setSessionPnl(0);
      setLossStreak(0);

      const runner = new DerivBot(
        socket,
        {
          symbol,
          currency: selectedAccount.currency,
          duration: Number(duration),
          baseStake,
          recoveryMultiplier: multiplier,
          takeProfit: takeProfitValue,
          stopLoss: stopLossValue,
          waitForFailedCycle,
          initialPnl: 0,
          initialLossStreak: 0,
        },
        {
          onTrade: (trade) => {
            const sessionTrade = { ...trade, sessionId: newSession.id };
            const previousTrade = tradeRecordsRef.current.find(
              (existing) => existing.id === trade.id && existing.sessionId === newSession.id,
            );
            const nextTrades = previousTrade
              ? tradeRecordsRef.current.map((existing) =>
                  existing.id === trade.id && existing.sessionId === newSession.id
                    ? sessionTrade
                    : existing,
                )
              : [sessionTrade, ...tradeRecordsRef.current].slice(0, MAX_SAVED_TRADES);
            tradeRecordsRef.current = nextTrades;
            setTrades(nextTrades);
            sessionRecordsRef.current = updateTradingSessionTrade(
              sessionRecordsRef.current,
              newSession.id,
              sessionTrade,
              previousTrade,
            );
            setSessions(sessionRecordsRef.current);
            setHasOpenTrade(trade.status === "Open");
            if (trade.status !== "Open" && notifyEnabled) {
              showNotice(
                `${trade.contract} ${trade.status.toLowerCase()} · ${formatMoney(trade.profit ?? 0, selectedAccount.currency)}`,
              );
            }
          },
          onPnl: (profit, nextLossStreak) => {
            setSessionPnl(profit);
            setLossStreak(nextLossStreak);
            if (pendingSessionSaveIdRef.current === newSession.id && !runner.isBusy) {
              pendingSessionSaveIdRef.current = null;
              closeSession(newSession.id, "saved");
              showNotice("Session saved to Session history.");
            }
            if (!runner.isActive && !runner.isBusy) closeBotSocket(runner, socket);
          },
          onStop: (reason) => {
            setIsRunning(false);
            if (
              sessionRecordsRef.current.find((session) => session.id === newSession.id)?.status !==
              "saved"
            ) {
              closeSession(newSession.id, "completed");
            }
            showNotice(reason);
            closeBotSocket(runner, socket);
          },
          onError: (error) => {
            setIsRunning(false);
            if (pendingSessionSaveIdRef.current === newSession.id) {
              pendingSessionSaveIdRef.current = null;
            }
            closeSession(newSession.id, "interrupted");
            setHasOpenTrade(runner.hasOpenContract);
            showNotice(
              runner.hasOpenContract
                ? "Deriv disconnected while a contract was open. Check your Deriv contract history before starting again."
                : error.message,
            );
            closeBotSocket(runner, socket);
          },
        },
      );
      botSocketRef.current = socket;
      botRef.current = runner;
      setIsRunning(true);
      await runner.start();
      if (!runner.isActive) setIsRunning(false);
    } catch (error) {
      setIsRunning(false);
      if (createdSessionId) closeSession(createdSessionId, "failed");
      showNotice(error instanceof Error ? error.message : "Could not start the bot.");
    } finally {
      setBotBusy(false);
    }
  }

  function startRequestedBot() {
    if (selectedAccount?.accountType === "real") setLiveConfirmationOpen(true);
    else void startBot();
  }

  function pauseBot() {
    const runner = botRef.current;
    runner?.pause();
    if (activeSessionIdRef.current) closeSession(activeSessionIdRef.current, "paused");
    setIsRunning(false);
    if (runner && !runner.isBusy) closeBotSocket(runner, botSocketRef.current);
    showNotice("Bot paused. An open trade will still be monitored until it settles.");
  }

  function stopBot() {
    const runner = botRef.current;
    runner?.pause();
    if (activeSessionIdRef.current) closeSession(activeSessionIdRef.current, "stopped");
    setIsRunning(false);
    if (runner && !runner.isBusy) closeBotSocket(runner, botSocketRef.current);
    showNotice(
      runner?.hasOpenContract
        ? "Bot stopped. No new trades will open; the current trade will be monitored until it settles."
        : "Bot stopped.",
    );
  }

  function closeBotSocket(runner: DerivBot, socket: DerivSocketClient | null) {
    if (botRef.current !== runner || runner.isBusy) return;
    socket?.close();
    botRef.current = null;
    botSocketRef.current = null;
    activeSessionIdRef.current = null;
    setHasOpenTrade(false);
  }

  async function exportTrades() {
    if (!trades.length) {
      showNotice("There are no trades to export yet.");
      return;
    }
    const filename = `overunder-history-${new Date().toISOString().slice(0, 10)}.csv`;
    const file = new File([tradingHistoryCsv(trades)], filename, {
      type: "text/csv;charset=utf-8",
    });
    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: "OverUnderAuto trade history" });
        showNotice("Trade history is ready to save or share.");
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        downloadTradeHistory(file, filename);
      }
      return;
    }
    downloadTradeHistory(file, filename);
  }

  async function installApp() {
    if (installPrompt) {
      try {
        await installPrompt.prompt();
        const choice = await installPrompt.userChoice;
        setInstallPrompt(null);
        showNotice(
          choice.outcome === "accepted"
            ? "OverUnderAuto is being installed."
            : "Install dismissed.",
        );
      } catch {
        showNotice("Use your browser menu to install OverUnderAuto.");
      }
      return;
    }
    if (iosInstallAvailable) {
      showNotice("Tap Share in Safari, then choose Add to Home Screen.");
    }
  }

  return (
    <div
      className={
        isDark
          ? "dark min-h-[100dvh] bg-background pb-24 text-foreground lg:pb-0"
          : "min-h-[100dvh] bg-background pb-24 text-foreground lg:pb-0"
      }
    >
      <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur-sm">
        <div className="mx-auto flex h-[60px] max-w-[1760px] items-center justify-between gap-3 px-4 sm:px-6 xl:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <a href="#workspace" className="flex min-w-0 items-center gap-2.5">
              <img
                src={
                  isDark
                    ? "/brand/overunderauto-logo-on-dark.png"
                    : "/brand/overunderauto-logo-on-light.png"
                }
                alt="OverUnderAuto"
                className="h-8 w-auto max-w-[min(46vw,208px)] object-contain object-left"
              />
            </a>
            <span className="hidden h-7 w-px bg-border sm:block" />
            <span className="hidden items-center gap-2 text-sm text-muted-foreground sm:flex">
              <LayoutDashboard className="size-4" /> Workspace
            </span>
          </div>

          <div className="flex shrink-0 items-center gap-1 sm:gap-3">
            <div className="hidden items-center gap-2 rounded-md border border-border bg-card px-3 py-2 sm:flex">
              <span
                className={`size-2 rounded-full ${feedStatus === "live" ? "bg-positive" : "bg-amber-500"}`}
              />
              <span className="text-xs font-semibold text-muted-foreground">
                {feedStatus === "live" ? "Live market feed" : "Connecting feed"}
              </span>
            </div>
            <Button
              variant="outline"
              size="icon"
              aria-label={isDark ? "Switch to light appearance" : "Switch to dark appearance"}
              onClick={() => setIsDark(!isDark)}
            >
              {isDark ? <Sun /> : <Moon />}
            </Button>
            {accounts.length ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void disconnectDeriv()}
                disabled={accountBusy || isRunning || botBusy || hasOpenTrade}
              >
                {accountBusy ? "Disconnecting…" : "Disconnect"}
              </Button>
            ) : (
              <div className="hidden items-center gap-2 md:flex">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void beginDerivAuth("login")}
                  disabled={authBusy}
                >
                  Sign in
                </Button>
                <Button size="sm" onClick={() => void beginDerivAuth("signup")} disabled={authBusy}>
                  Create Deriv account
                </Button>
              </div>
            )}
            {!accounts.length && (
              <Button
                className="md:hidden"
                size="sm"
                onClick={() => void beginDerivAuth("login")}
                disabled={authBusy}
              >
                Connect
              </Button>
            )}
          </div>
        </div>
      </header>

      <main
        id="workspace"
        className="mx-auto max-w-[1760px] scroll-mt-16 px-3 py-3 sm:px-5 lg:py-4 xl:px-8"
      >
        <div className="mb-3 flex flex-col items-stretch gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-3">
          <div className="min-w-0 dashboard-enter">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-[0.12em] text-brand">
                Strategy desk
              </span>
              <Badge
                variant="outline"
                className="rounded-sm border-border bg-card font-medium text-muted-foreground"
              >
                Over / Under
              </Badge>
            </div>
            <h1 className="text-xl font-bold leading-tight sm:text-2xl">Strategy workspace</h1>
            <p className="mt-0.5 hidden text-xs text-muted-foreground sm:block">
              Live quotes, real account controls, and clear session limits.
            </p>
          </div>
          <div className="flex w-full flex-wrap items-center justify-start gap-1.5 sm:w-auto sm:justify-end">
            <Button
              size="sm"
              className="h-9 px-3 sm:px-4"
              onClick={isRunning ? pauseBot : startRequestedBot}
              disabled={!historyReady || botBusy || (hasOpenTrade && !isRunning)}
            >
              {isRunning ? <Pause /> : <Play />}
              {botBusy
                ? "Connecting…"
                : isRunning
                  ? "Pause bot"
                  : hasOpenTrade
                    ? "Trade settling"
                    : "Start bot"}
            </Button>
            {(isRunning || hasOpenTrade) && (
              <Button
                variant="destructive"
                size="sm"
                className="h-9 px-3"
                aria-label="Stop bot"
                onClick={stopBot}
                disabled={botBusy}
              >
                <Square />
                <span className="hidden sm:inline">Stop bot</span>
                <span className="sm:hidden">Stop</span>
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              className="h-9 px-2.5"
              onClick={saveCurrentSession}
              disabled={
                !currentSession ||
                currentSession.status === "saved" ||
                currentSession.status === "saving" ||
                botBusy
              }
              title="Save this session to Session history"
            >
              <Save />
              {currentSession?.status === "saving"
                ? "Saving…"
                : currentSession?.status === "saved"
                  ? "Saved"
                  : "Save session"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-9 px-2"
              onClick={resetSession}
              disabled={!currentSession || isRunning || botBusy || hasOpenTrade}
              title="Reset the current session and keep it in Session history"
            >
              <RotateCcw /> Reset
            </Button>
          </div>
        </div>

        <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Metric
            label="Session P/L"
            value={formatMoney(sessionPnl, selectedAccount?.currency ?? "USD")}
            detail={`${completedTrades.length} settled trade${completedTrades.length === 1 ? "" : "s"}`}
            {...(sessionPnl > 0 ? { tone: "positive" as const } : {})}
          />
          <Metric label="Win rate" value={winRate} detail={`${wins} wins · ${losses} losses`} />
          <Metric label="Saved trades" value={String(trades.length)} detail="On this device" />
          <Metric
            label="Bot status"
            value={botStatus}
            detail={
              selectedAccount
                ? `${selectedAccount.accountType === "demo" ? "Demo" : "Real"} account selected`
                : "Connect Deriv to trade"
            }
            status={isRunning}
          />
        </div>

        <TradeHistoryPanel
          selectedTab={selectedTab}
          onTabChange={setSelectedTab}
          trades={tradeLogTrades}
          totalTrades={trades.length}
          sessions={sessions}
          currentSessionId={currentSessionId}
          selectedTradeSessionId={selectedTradeSessionId}
          onReturnToCurrentSession={() => setSelectedTradeSessionId(null)}
          onViewSession={(sessionId) => {
            setSelectedTradeSessionId(sessionId);
            setSelectedTab("trades");
          }}
          historyReady={historyReady}
          historySaved={historySaved}
          onExport={() => void exportTrades()}
        />

        <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(250px,300px)_minmax(0,1fr)_minmax(235px,270px)]">
          <aside className="flex flex-col gap-3 dashboard-enter">
            <section
              id="account"
              className="scroll-mt-16 rounded-lg border border-border bg-card p-3 sm:p-4"
            >
              <SectionHeading
                title="Connection"
                note={accounts.length ? "CONNECTED" : "DERIV AUTH 2.0"}
              />
              <div className="mt-4 rounded-md border border-border bg-background p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">Deriv account</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      {accountsLoading
                        ? "Checking your secure session…"
                        : selectedAccount
                          ? `${selectedAccount.accountType === "demo" ? "Demo" : "Real"} account ending ${selectedAccount.accountId.slice(-4)}`
                          : "Sign in securely with Deriv to select an account."}
                    </p>
                  </div>
                  <span
                    className={`mt-1 size-2 shrink-0 rounded-full ${selectedAccount ? "bg-positive" : "bg-amber-500"}`}
                  />
                </div>
              </div>
              {accounts.length ? (
                <>
                  <Field label="Trading account">
                    <Select value={selectedAccountId} onValueChange={setSelectedAccountId}>
                      <SelectTrigger aria-label="Trading account">
                        <SelectValue placeholder="Select account" />
                      </SelectTrigger>
                      <SelectContent>
                        {accounts.map((account) => (
                          <SelectItem key={account.accountId} value={account.accountId}>
                            {account.accountType === "demo" ? "Demo" : "Real"} · …
                            {account.accountId.slice(-4)} · {account.currency}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <div className="mt-4 flex items-center justify-between border-t border-border pt-4 text-sm">
                    <span className="text-muted-foreground">Balance</span>
                    <span className="numeric font-semibold">
                      {selectedAccount?.balance === null || selectedAccount?.balance === undefined
                        ? "—"
                        : formatMoney(selectedAccount.balance, selectedAccount.currency)}
                    </span>
                  </div>
                </>
              ) : (
                <Button
                  variant="outline"
                  className="mt-3 w-full"
                  onClick={() => void beginDerivAuth("login")}
                  disabled={authBusy || accountsLoading}
                >
                  {authBusy ? "Opening Deriv…" : "Connect Deriv"}
                  <ArrowUpRight />
                </Button>
              )}
              {!accounts.length && (
                <p className="mt-3 text-[11px] leading-5 text-muted-foreground">
                  Your access token stays in a secure, HTTP-only session cookie.
                </p>
              )}
              {(installPrompt || iosInstallAvailable) && (
                <Button variant="outline" className="mt-3 w-full" onClick={() => void installApp()}>
                  <Download /> Install app
                </Button>
              )}
            </section>

            <section className="rounded-lg border border-border bg-card p-3 sm:p-4">
              <SectionHeading title="Strategy" note="OVER / UNDER" />
              <div className="mt-4 space-y-4">
                <Field label="Market">
                  <Select value={symbol} onValueChange={setSymbol}>
                    <SelectTrigger aria-label="Market">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DERIV_MARKETS.map((entry) => (
                        <SelectItem key={entry.symbol} value={entry.symbol}>
                          {entry.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Base stake">
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                        $
                      </span>
                      <Input
                        className="pl-7 numeric"
                        aria-label="Base stake"
                        type="number"
                        value={stake}
                        onChange={(event) => setStake(event.target.value)}
                        min="0.35"
                        step="0.05"
                      />
                    </div>
                  </Field>
                  <Field label="Duration">
                    <Select value={duration} onValueChange={setDuration}>
                      <SelectTrigger aria-label="Duration">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1">1 tick</SelectItem>
                        <SelectItem value="2">2 ticks</SelectItem>
                        <SelectItem value="5">5 ticks</SelectItem>
                        <SelectItem value="10">10 ticks</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                </div>
                <SettingRow
                  label="Wait for failed cycle"
                  description={
                    waitForFailedCycle
                      ? "Wait for a failed Over 1 or Under 8 setup before each entry."
                      : "Off — trade when the regular strategy signal appears."
                  }
                  checked={waitForFailedCycle}
                  onCheckedChange={setWaitForFailedCycle}
                  disabled={isRunning || botBusy || hasOpenTrade}
                />
                <div className="rounded-md bg-brand-soft p-3">
                  <p className="text-xs font-bold uppercase tracking-[0.08em] text-brand">
                    Entry rule
                  </p>
                  <p className="mt-1.5 text-sm leading-5">
                    {waitForFailedCycle ? (
                      "Wait for two consecutive 0 or 1 ticks before placing Over 1."
                    ) : (
                      <>
                        When the latest digit is <span className="numeric font-semibold">0</span> or{" "}
                        <span className="numeric font-semibold">1</span>, place{" "}
                        <span className="font-bold text-brand">Over 1</span>.
                      </>
                    )}
                  </p>
                  <p className="mt-2 text-xs leading-[1.6] text-muted-foreground">
                    {waitForFailedCycle
                      ? "After a loss, wait for an 8 or 9 before each Under 8 recovery."
                      : "After a loss, use Under 8 until it wins, then resume analysis."}
                  </p>
                </div>
              </div>
            </section>

            <section
              id="risk"
              className="scroll-mt-16 rounded-lg border border-border bg-card p-3 sm:p-4"
            >
              <SectionHeading title="Risk limits" note="SESSION GUARDRAILS" />
              <div className="mt-4 space-y-4">
                <RiskInput
                  label="Take profit"
                  enabled={takeProfitEnabled}
                  setEnabled={setTakeProfitEnabled}
                  value={takeProfit}
                  setValue={setTakeProfit}
                />
                <RiskInput
                  label="Stop loss"
                  enabled={stopLossEnabled}
                  setEnabled={setStopLossEnabled}
                  value={stopLoss}
                  setValue={setStopLoss}
                />
                <div>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold">Recovery multiplier</span>
                    <Badge variant="outline" className="rounded-sm font-medium">
                      After a loss
                    </Badge>
                  </div>
                  <div className="grid grid-cols-5 gap-1.5">
                    {recoverySteps.map((step) => (
                      <Button
                        key={step}
                        variant={multiplier === step ? "default" : "outline"}
                        size="sm"
                        className="min-w-0 px-1 text-xs numeric"
                        aria-pressed={multiplier === step}
                        onClick={() => setMultiplier(step)}
                      >
                        ×{step}
                      </Button>
                    ))}
                  </div>
                  <p className="mt-2 text-xs leading-5 text-muted-foreground">
                    Next recovery stake:{" "}
                    {formatMoney(
                      Number(stake) * multiplier ** Math.max(1, lossStreak),
                      selectedAccount?.currency ?? "USD",
                    )}
                    .
                  </p>
                </div>
              </div>
            </section>
          </aside>

          <div className="flex min-w-0 flex-col gap-3">
            <div className="grid gap-3 2xl:grid-cols-[minmax(0,1.2fr)_minmax(300px,0.8fr)]">
              <section className="min-w-0 rounded-lg border border-border bg-card p-3 sm:p-4 dashboard-enter-delay">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <SectionHeading
                      title="Last digit"
                      note={feedStatus === "live" ? "LIVE FEED" : "MARKET FEED"}
                    />
                    <p className="mt-2 text-xs text-muted-foreground">{market.label}</p>
                  </div>
                  <Badge
                    variant="outline"
                    className={`rounded-sm ${feedStatus === "live" ? "border-positive/30 bg-positive-soft text-positive" : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"}`}
                  >
                    <span className="mr-1.5 inline-block size-1.5 rounded-full bg-current" />
                    {feedStatus === "live"
                      ? "Live"
                      : feedStatus === "reconnecting"
                        ? "Reconnecting"
                        : feedStatus === "unavailable"
                          ? "Unavailable"
                          : "Connecting"}
                  </Badge>
                </div>
                <div className="mt-6 grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3">
                  <div className="flex items-end gap-4">
                    <span className="numeric text-[84px] font-medium leading-[0.85] text-brand sm:text-[96px]">
                      {latestTick?.digit ?? "–"}
                    </span>
                    <div className="pb-1">
                      <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                        Latest digit
                      </p>
                      <p className="numeric mt-1 text-sm font-medium">
                        {latestTick
                          ? `From ${formatQuote(latestTick.quote, latestTick.pipSize)}`
                          : "Waiting for a quote"}
                      </p>
                    </div>
                  </div>
                  <div className="pb-1 text-right">
                    <p className="text-xs text-muted-foreground">
                      {latestTick ? "Live price" : "Market price"}
                    </p>
                    <p className="numeric mt-1 text-xl font-semibold">
                      {latestTick ? formatQuote(latestTick.quote, latestTick.pipSize) : "—"}
                    </p>
                  </div>
                </div>
                <div
                  className="mt-6 grid grid-cols-10 gap-1.5 sm:gap-2"
                  aria-label="Live digit history"
                >
                  {feed.slice(-40).map((point, index) => (
                    <span
                      key={`${point.epoch}-${index}`}
                      className={`numeric grid aspect-square min-w-0 place-items-center rounded-[4px] text-xs font-semibold sm:text-sm ${index === Math.min(feed.length, 40) - 1 ? "bg-brand text-primary-foreground" : "bg-background text-muted-foreground"}`}
                    >
                      {point.digit}
                    </span>
                  ))}
                  {!feed.length && (
                    <p className="col-span-10 py-3 text-center text-xs text-muted-foreground">
                      The live digit stream will appear here.
                    </p>
                  )}
                </div>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-xs">
                  <span className="text-muted-foreground">Entry signal</span>
                  <span className="flex items-center gap-2 font-semibold text-brand">
                    <span
                      className={`size-1.5 rounded-full ${currentSignal.startsWith("Waiting") ? "bg-muted-foreground" : "bg-positive"}`}
                    />
                    {currentSignal}
                  </span>
                </div>
              </section>

              <section className="min-w-0 rounded-lg border border-border bg-card p-3 sm:p-4 dashboard-enter-delay">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <SectionHeading
                      title="Market movement"
                      note={feedStatus === "live" ? "LIVE DATA" : "NO DATA"}
                    />
                    <p className="mt-2 flex items-center gap-1.5 text-sm font-semibold">
                      {latestTick ? (
                        <>
                          <TrendingUp className="size-4 text-positive" />
                          {formatQuote(latestTick.quote, latestTick.pipSize)}
                        </>
                      ) : (
                        <span className="text-muted-foreground">Waiting for market data</span>
                      )}
                    </p>
                  </div>
                  <Select
                    value={String(chartWindow)}
                    onValueChange={(value) => setChartWindow(Number(value))}
                  >
                    <SelectTrigger className="h-8 w-[78px] text-xs" aria-label="Chart time range">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="60">1 min</SelectItem>
                      <SelectItem value="300">5 min</SelectItem>
                      <SelectItem value="900">15 min</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div
                  className="mt-3 h-[128px] w-full"
                  role="img"
                  aria-label="Live market line chart"
                >
                  <svg
                    className="h-full w-full overflow-visible"
                    viewBox="0 0 440 160"
                    preserveAspectRatio="none"
                  >
                    <g className="market-grid">
                      <line x1="0" y1="20" x2="440" y2="20" />
                      <line x1="0" y1="60" x2="440" y2="60" />
                      <line x1="0" y1="100" x2="440" y2="100" />
                      <line x1="0" y1="140" x2="440" y2="140" />
                    </g>
                    {chartPath && (
                      <>
                        <path className="market-line" d={chartPath} />
                        <circle
                          className="market-point"
                          cx="440"
                          cy={chartPathEndY(chartPath)}
                          r="4"
                        />
                      </>
                    )}
                  </svg>
                  {feed.length < 2 && (
                    <p className="-mt-20 text-center text-xs text-muted-foreground">
                      Live prices will draw as ticks arrive.
                    </p>
                  )}
                </div>
                <div className="mt-3 flex justify-between text-[10px] text-muted-foreground numeric">
                  <span>
                    {visibleChartFeed.length ? formatTime(visibleChartFeed.at(0)!.epoch) : "—"}
                  </span>
                  <span>
                    {visibleChartFeed.length ? formatTime(visibleChartFeed.at(-1)!.epoch) : "—"}
                  </span>
                </div>
              </section>
            </div>

            <section className="rounded-lg border border-border bg-card p-3 sm:p-4">
              <div className="flex items-center justify-between gap-3">
                <SectionHeading
                  title="Recent ticks"
                  note={feedStatus === "live" ? "LIVE STREAM" : "WAITING"}
                />
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Clock3 className="size-3.5" />
                  Last 5
                </span>
              </div>
              <div className="mt-4 grid grid-cols-[1fr_1fr_52px] gap-x-4 border-b border-border pb-2 text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                <span>Time</span>
                <span className="text-right">Price</span>
                <span className="text-right">Digit</span>
              </div>
              <div className="divide-y divide-border">
                {feed
                  .slice(-5)
                  .reverse()
                  .map((point, index) => (
                    <div
                      key={point.epoch}
                      className="grid grid-cols-[1fr_1fr_52px] items-center gap-x-4 py-2.5 text-sm"
                    >
                      <span className="numeric text-xs text-muted-foreground">
                        {formatTime(point.epoch)}
                      </span>
                      <span className="numeric text-right">
                        {formatQuote(point.quote, point.pipSize)}
                      </span>
                      <span
                        className={`numeric text-right font-semibold ${index === 0 ? "text-brand" : "text-muted-foreground"}`}
                      >
                        {point.digit}
                      </span>
                    </div>
                  ))}
                {!feed.length && (
                  <p className="py-6 text-center text-xs text-muted-foreground">
                    No ticks received yet.
                  </p>
                )}
              </div>
            </section>
          </div>

          <aside className="flex min-w-0 flex-col gap-3 dashboard-enter-delay">
            <section className="hidden rounded-lg border border-border bg-card p-3 sm:p-4 xl:block">
              <SectionHeading title="Session" note="LIVE RESULTS" />
              <div
                className={`mt-4 rounded-md p-4 ${sessionPnl >= 0 ? "bg-positive-soft" : "bg-destructive/10"}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold uppercase tracking-[0.1em] text-muted-foreground">
                    Net P/L
                  </span>
                  <Badge
                    variant="outline"
                    className="rounded-sm border-border bg-card font-semibold"
                  >
                    {selectedAccount?.currency ?? "USD"}
                  </Badge>
                </div>
                <p
                  className={`numeric mt-3 text-3xl font-medium ${sessionPnl > 0 ? "text-positive" : sessionPnl < 0 ? "text-destructive" : "text-foreground"}`}
                >
                  {formatMoney(sessionPnl, selectedAccount?.currency ?? "USD")}
                </p>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2.5">
                <SmallMetric label="Wins" value={String(wins)} positive />
                <SmallMetric label="Losses" value={String(losses)} />
                <SmallMetric label="Trades" value={String(currentSessionTrades.length)} />
                <SmallMetric label="Win rate" value={winRate} />
              </div>
            </section>

            <section className="hidden rounded-lg border border-border bg-card p-3 sm:p-4 xl:block">
              <div className="flex items-center justify-between gap-3">
                <SectionHeading title="Bot details" note="CURRENT SETUP" />
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  aria-label="Strategy explanation"
                  onClick={() =>
                    showNotice(
                      waitForFailedCycle
                        ? "The bot waits for two consecutive 0/1 ticks before Over 1, and waits for 8 or 9 before each Under 8 recovery, until a session limit is reached."
                        : "The bot waits for a 0 or 1, trades Over 1, then recovers with Under 8 after a loss.",
                    )
                  }
                >
                  <ShieldCheck />
                </Button>
              </div>
              <dl className="mt-4 space-y-3.5">
                <DetailRow label="Status" value={botStatus} />
                <DetailRow label="Market" value={market.label} />
                <DetailRow label="Entry trigger" value="Digit 0 or 1" />
                <DetailRow label="First direction" value="Over 1" />
                <DetailRow label="After a loss" value="Under 8 until win" />
                <DetailRow label="Failed-cycle filter" value={waitForFailedCycle ? "On" : "Off"} />
                <DetailRow label="Recovery" value={`×${multiplier}`} />
              </dl>
              <div className="mt-4 flex items-start gap-2 rounded-md border border-border bg-background p-3">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-brand" />
                <p className="text-xs leading-[1.6] text-muted-foreground">
                  Bot runs only after you start it. Stop prevents new trades; an open trade stays
                  monitored until it settles. Real accounts require a separate confirmation.
                </p>
              </div>
            </section>

            <section className="rounded-lg border border-border bg-card p-3 sm:p-4">
              <SectionHeading title="Trade alerts" />
              <div className="mt-1">
                <SettingRow
                  label="Trade results"
                  description="In-app result notifications"
                  checked={notifyEnabled}
                  onCheckedChange={setNotifyEnabled}
                />
              </div>
            </section>

            <p className="px-1 text-[11px] leading-[1.6] text-muted-foreground">
              Trading involves risk. Start with a demo account and review the stake and risk limits
              before running the strategy.
            </p>
          </aside>
        </div>
      </main>

      <nav
        aria-label="Main navigation"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 px-2 pt-2 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] backdrop-blur-sm lg:hidden"
      >
        <div className="mx-auto grid max-w-lg grid-cols-4">
          {[
            { href: "#workspace", label: "Workspace", icon: LayoutDashboard },
            { href: "#history", label: "History", icon: History },
            { href: "#risk", label: "Risk", icon: ShieldCheck },
            { href: "#account", label: "Account", icon: Disc3 },
          ].map(({ href, label, icon: Icon }) => (
            <a
              key={href}
              href={href}
              aria-current={activeMobileSection === href.slice(1) ? "location" : undefined}
              onClick={() => setActiveMobileSection(href.slice(1))}
              className={`flex min-h-12 flex-col items-center justify-center gap-1 rounded-md text-[10px] font-medium transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${activeMobileSection === href.slice(1) ? "text-brand" : "text-muted-foreground hover:text-foreground"}`}
            >
              <Icon className="size-4" aria-hidden="true" />
              {label}
            </a>
          ))}
        </div>
      </nav>

      <footer className="border-t border-border">
        <div className="mx-auto hidden max-w-[1760px] flex-wrap items-center justify-between gap-2 px-4 py-4 text-xs text-muted-foreground sm:px-6 lg:flex xl:px-8">
          <span>
            OverUnderAuto <span className="mx-1.5">·</span> Live workspace
          </span>
          <span className="flex items-center gap-2">
            <span
              className={`size-1.5 rounded-full ${selectedAccount ? "bg-positive" : "bg-amber-500"}`}
            />
            {selectedAccount
              ? `Connected to Deriv · ${selectedAccount.accountType}`
              : feedStatus === "live"
                ? "Live feed · account not connected"
                : "Waiting for Deriv market feed"}
          </span>
        </div>
      </footer>

      {notice && (
        <div
          role="status"
          className="fixed bottom-20 left-1/2 z-50 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-2 rounded-md border border-border bg-popover px-4 py-3 text-sm text-popover-foreground shadow-lg lg:bottom-4"
        >
          <span className="size-2 shrink-0 rounded-full bg-brand" />
          {notice}
          <Button
            size="icon"
            variant="ghost"
            className="-mr-2 size-7"
            aria-label="Dismiss message"
            onClick={() => setNotice("")}
          >
            <X />
          </Button>
        </div>
      )}

      <AlertDialog open={liveConfirmationOpen} onOpenChange={setLiveConfirmationOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Start on a real account?</AlertDialogTitle>
            <AlertDialogDescription>
              You selected a real Deriv account. The bot will place trades using real funds with a
              base stake of {formatMoney(Number(stake) || 0, selectedAccount?.currency ?? "USD")}{" "}
              and the risk limits shown on this page.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setLiveConfirmationOpen(false);
                void startBot();
              }}
            >
              Start real trading
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function downloadTradeHistory(file: File, filename: string) {
  const url = URL.createObjectURL(file);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function makeSessionId(): string {
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function feedPoint(tick: DerivTick): FeedPoint | null {
  const quote = Number(tick.quote);
  const pipSize = tick.pip_size ?? 2;
  const digit = lastDigit(tick.quote, pipSize);
  if (!Number.isFinite(quote) || !Number.isFinite(tick.epoch) || digit === null) return null;
  return { epoch: tick.epoch, quote, pipSize, digit };
}

function historyPoints(message: DerivMessage): FeedPoint[] {
  const history = message.history;
  if (!history || !Array.isArray(history.prices) || !Array.isArray(history.times)) return [];
  const pipSize = typeof message["pip_size"] === "number" ? message["pip_size"] : 2;
  return history.prices.flatMap((quote, index) => {
    const epoch = history.times?.[index];
    if (epoch === undefined) return [];
    const point = feedPoint({ quote, epoch, pip_size: pipSize });
    return point ? [point] : [];
  });
}

function makeChartPath(points: FeedPoint[]): string | null {
  if (points.length < 2) return null;
  const values = points.map((point) => point.quote);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = max - min || Math.max(Math.abs(max) * 0.0001, 0.0001);
  return values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * 440;
      const y = 140 - ((value - min) / spread) * 120;
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}

function chartPathEndY(path: string): number {
  return Number(path.trim().split(/\s+/).at(-1)) || 20;
}

function formatQuote(quote: number, pipSize: number): string {
  return quote.toFixed(Math.max(0, Math.min(12, pipSize)));
}

function formatTime(epoch: number): string {
  return new Date(epoch * 1000).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `$${amount.toFixed(2)}`;
  }
}

function SectionHeading({ title, note }: { title: string; note?: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <h2 className="truncate text-sm font-bold">{title}</h2>
      {note && (
        <span className="shrink-0 text-[9px] font-bold tracking-[0.1em] text-muted-foreground">
          {note}
        </span>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block min-w-0 space-y-1.5">
      <span className="text-xs font-semibold text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function Metric({
  label,
  value,
  detail,
  tone,
  status,
}: {
  label: string;
  value: string;
  detail: string;
  tone?: "positive";
  status?: boolean;
}) {
  return (
    <section className="min-w-0 rounded-lg border border-border bg-card px-3 py-2.5 sm:px-3.5 sm:py-3">
      <p className="truncate text-[11px] font-semibold text-muted-foreground">{label}</p>
      <p
        className={`mt-1 truncate text-base font-bold sm:text-lg ${tone === "positive" ? "text-positive numeric" : ""}`}
      >
        {status && (
          <span className="mr-2 inline-block size-2 rounded-full bg-positive align-middle" />
        )}
        {value}
      </p>
      <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{detail}</p>
    </section>
  );
}

function SmallMetric({
  label,
  value,
  positive,
}: {
  label: string;
  value: string;
  positive?: boolean;
}) {
  return (
    <div className="min-w-0 rounded-md border border-border bg-background px-3 py-3">
      <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </p>
      <p
        className={`numeric mt-1 text-xl font-medium ${positive ? "text-positive" : "text-foreground"}`}
      >
        {value}
      </p>
    </div>
  );
}

function RiskInput({
  label,
  enabled,
  setEnabled,
  value,
  setValue,
}: {
  label: string;
  enabled: boolean;
  setEnabled: (value: boolean) => void;
  value: string;
  setValue: (value: string) => void;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="text-xs font-semibold">{label}</span>
        <Switch
          aria-label={`${label} limit enabled`}
          checked={enabled}
          onCheckedChange={setEnabled}
        />
      </div>
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
          $
        </span>
        <Input
          className="pl-7 numeric"
          type="number"
          min="0.01"
          step="0.5"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          aria-label={`${label} amount`}
          disabled={!enabled}
        />
      </div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] items-start gap-2 text-xs">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-right font-semibold">{value}</dd>
    </div>
  );
}

function SettingRow({
  label,
  description,
  checked,
  onCheckedChange,
  disabled = false,
}: {
  label: string;
  description: string;
  checked: boolean;
  onCheckedChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch
        aria-label={label}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
      />
    </div>
  );
}

function TradeHistoryPanel({
  selectedTab,
  onTabChange,
  trades,
  totalTrades,
  sessions,
  currentSessionId,
  selectedTradeSessionId,
  onReturnToCurrentSession,
  onViewSession,
  historyReady,
  historySaved,
  onExport,
}: {
  selectedTab: string;
  onTabChange: (tab: string) => void;
  trades: StrategyTrade[];
  totalTrades: number;
  sessions: TradingSession[];
  currentSessionId: string | null;
  selectedTradeSessionId: string | null;
  onReturnToCurrentSession: () => void;
  onViewSession: (sessionId: string) => void;
  historyReady: boolean;
  historySaved: boolean;
  onExport: () => void;
}) {
  return (
    <section
      id="history"
      className="min-w-0 scroll-mt-16 rounded-lg border border-border bg-card dashboard-enter-delay"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2 sm:px-4">
        <Tabs value={selectedTab} onValueChange={onTabChange}>
          <TabsList className="h-8 bg-muted p-1">
            <TabsTrigger value="trades" className="h-6 px-2.5 text-xs">
              <LayoutDashboard className="mr-1.5 size-3.5" /> Trade log
            </TabsTrigger>
            <TabsTrigger value="history" className="h-6 px-2.5 text-xs">
              <History className="mr-1.5 size-3.5" /> Session history
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <Button variant="outline" size="sm" className="ml-auto h-8" onClick={onExport}>
          <Download /> Export history
        </Button>
      </div>
      <p
        className={`border-b border-border px-3 py-1.5 text-[11px] sm:px-4 ${historyReady && !historySaved ? "text-destructive" : "text-muted-foreground"}`}
        role="status"
      >
        {!historyReady
          ? "Loading saved history…"
          : !historySaved
            ? "Could not save. Export a CSV backup."
            : totalTrades >= MAX_SAVED_TRADES
              ? "10,000 trade limit reached; oldest trades roll off. Export a full backup."
              : "Saved on this device"}
      </p>
      <Tabs value={selectedTab} onValueChange={onTabChange}>
        <TabsContent value="trades" className="m-0">
          {selectedTradeSessionId && selectedTradeSessionId !== currentSessionId && (
            <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2 sm:px-4">
              <span className="text-xs text-muted-foreground">Viewing a saved session</span>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={onReturnToCurrentSession}
              >
                Current session
              </Button>
            </div>
          )}
          <TradeTable
            trades={trades}
            history={Boolean(currentSessionId || selectedTradeSessionId)}
          />
        </TabsContent>
        <TabsContent value="history" className="m-0">
          <SessionHistoryList sessions={sessions} onViewSession={onViewSession} />
        </TabsContent>
      </Tabs>
    </section>
  );
}

function SessionHistoryList({
  sessions,
  onViewSession,
}: {
  sessions: TradingSession[];
  onViewSession: (sessionId: string) => void;
}) {
  const [page, setPage] = useState(0);
  const pageSize = 12;
  const pageCount = Math.max(1, Math.ceil(sessions.length / pageSize));
  const pageIndex = Math.min(page, pageCount - 1);
  const pageSessions = sessions.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize);

  if (!sessions.length) {
    return (
      <p className="px-4 py-6 text-center text-sm text-muted-foreground">
        Sessions appear here each time you start the bot.
      </p>
    );
  }

  return (
    <div className="p-2.5 sm:p-3">
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {pageSessions.map((session) => (
          <article
            key={session.id}
            className="rounded-md border border-border bg-background px-3 py-2.5"
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-xs font-semibold">{formatSessionDate(session.startedAt)}</p>
                <p className="mt-0.5 text-[11px] capitalize text-muted-foreground">
                  {session.status}
                </p>
              </div>
              <p
                className={`numeric text-sm font-bold ${session.pnl > 0 ? "text-positive" : session.pnl < 0 ? "text-destructive" : "text-foreground"}`}
              >
                {session.pnl > 0 ? "+" : ""}
                {formatMoney(session.pnl, session.currency)}
              </p>
            </div>
            <div className="mt-2 flex items-center justify-between gap-2 border-t border-border pt-2">
              <p className="text-[11px] text-muted-foreground">
                {session.tradeCount} trades · {session.wins}W / {session.losses}L
              </p>
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2 text-[11px]"
                onClick={() => onViewSession(session.id)}
              >
                View log
              </Button>
            </div>
          </article>
        ))}
      </div>
      {pageCount > 1 && (
        <div className="mt-2 flex items-center justify-between border-t border-border pt-2 text-xs text-muted-foreground">
          <span>
            {pageIndex * pageSize + 1}–{Math.min((pageIndex + 1) * pageSize, sessions.length)} of{" "}
            {sessions.length} sessions
          </span>
          <div className="flex gap-1.5">
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2"
              aria-label="Previous session history page"
              disabled={pageIndex === 0}
              onClick={() => setPage((current) => Math.max(0, current - 1))}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2"
              aria-label="Next session history page"
              disabled={pageIndex === pageCount - 1}
              onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function formatSessionDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
}

function TradeTable({ trades, history = false }: { trades: StrategyTrade[]; history?: boolean }) {
  const [page, setPage] = useState(0);
  const pageSize = 25;
  const pageCount = Math.max(1, Math.ceil(trades.length / pageSize));
  const pageIndex = Math.min(page, pageCount - 1);
  const pageTrades = trades.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize);

  return (
    <div>
      {!trades.length ? (
        <p className="px-5 py-10 text-center text-sm text-muted-foreground">
          {history
            ? "Settled trades will appear here."
            : "Start the bot to record your first trade."}
        </p>
      ) : (
        <>
          <div className="divide-y divide-border md:hidden">
            {pageTrades.map((trade, index) => {
              const currency = trade.currency ?? "USD";
              const run = trades.length - pageIndex * pageSize - index;
              return (
                <article key={trade.id} className="space-y-3 px-4 py-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold">Run #{String(run).padStart(2, "0")}</p>
                      <p className="mt-1 numeric text-xs text-muted-foreground">{trade.time}</p>
                    </div>
                    <TradeStatus trade={trade} />
                  </div>
                  <div className="flex items-end justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold">{trade.contract}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Entry {trade.entryDigit} <span aria-hidden="true">→</span> Exit{" "}
                        {trade.exitDigit}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="numeric text-sm">{formatMoney(trade.stake, currency)}</p>
                      <p
                        className={`numeric mt-1 text-xs font-semibold ${trade.profit !== null && trade.profit > 0 ? "text-positive" : trade.profit !== null && trade.profit < 0 ? "text-destructive" : "text-muted-foreground"}`}
                      >
                        {trade.profit === null
                          ? "P/L —"
                          : `P/L ${trade.profit > 0 ? "+" : ""}${formatMoney(trade.profit, currency)}`}
                      </p>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[700px] border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-border text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
                  <th className="px-4 py-3 font-semibold sm:px-5">Run</th>
                  <th className="px-3 py-3 font-semibold">Time</th>
                  <th className="px-3 py-3 font-semibold">Entry</th>
                  <th className="px-3 py-3 font-semibold">Contract</th>
                  <th className="px-3 py-3 font-semibold">Exit</th>
                  <th className="px-3 py-3 font-semibold">Stake</th>
                  <th className="px-3 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 text-right font-semibold sm:px-5">P/L</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {pageTrades.map((trade, index) => (
                  <tr key={trade.id} className="hover:bg-muted/40">
                    <td className="numeric px-4 py-3.5 font-medium sm:px-5">
                      #{String(trades.length - pageIndex * pageSize - index).padStart(2, "0")}
                    </td>
                    <td className="numeric px-3 py-3.5 text-muted-foreground">{trade.time}</td>
                    <td className="numeric px-3 py-3.5">{trade.entryDigit}</td>
                    <td className="px-3 py-3.5">{trade.contract}</td>
                    <td className="numeric px-3 py-3.5">{trade.exitDigit}</td>
                    <td className="numeric px-3 py-3.5">
                      {formatMoney(trade.stake, trade.currency ?? "USD")}
                    </td>
                    <td className="px-3 py-3.5">
                      <TradeStatus trade={trade} />
                    </td>
                    <td
                      className={`numeric px-4 py-3.5 text-right font-semibold sm:px-5 ${trade.profit !== null && trade.profit > 0 ? "text-positive" : trade.profit !== null && trade.profit < 0 ? "text-destructive" : ""}`}
                    >
                      {trade.profit === null
                        ? "—"
                        : `${trade.profit > 0 ? "+" : ""}${formatMoney(trade.profit, trade.currency ?? "USD")}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pageCount > 1 && (
            <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-3 text-xs text-muted-foreground sm:px-5">
              <span>
                {pageIndex * pageSize + 1}–{Math.min((pageIndex + 1) * pageSize, trades.length)} of{" "}
                {trades.length}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8"
                  onClick={() => setPage((current) => Math.max(0, current - 1))}
                  disabled={pageIndex === 0}
                  aria-label="Previous history page"
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8"
                  onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))}
                  disabled={pageIndex === pageCount - 1}
                  aria-label="Next history page"
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function TradeStatus({ trade }: { trade: StrategyTrade }) {
  return (
    <Badge
      variant="outline"
      className={`whitespace-nowrap rounded-sm font-medium ${trade.status === "Won" ? "border-positive/30 bg-positive-soft text-positive" : trade.status === "Lost" ? "border-destructive/30 text-destructive" : "text-muted-foreground"}`}
    >
      {trade.status}
    </Badge>
  );
}
