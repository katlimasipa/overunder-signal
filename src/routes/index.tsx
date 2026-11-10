import { useState, type FormEvent, type ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  ArrowDownRight,
  ArrowUpRight,
  Bell,
  Check,
  ChevronDown,
  CircleHelp,
  Clock3,
  Command,
  Copy,
  Disc3,
  History,
  LayoutDashboard,
  Menu,
  Moon,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  ShieldCheck,
  SlidersHorizontal,
  Sun,
  TrendingUp,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "OverUnderAuto — Strategy workspace" },
      {
        name: "description",
        content: "Explore the OverUnderAuto digit strategy workspace and risk controls in preview mode.",
      },
      { property: "og:title", content: "OverUnderAuto — Strategy workspace" },
      {
        property: "og:description",
        content: "A clear trading workspace preview for digit strategies and risk settings.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Dashboard,
});

const tickPrices = [
  { time: "20:44:18", price: "4.551", digit: "1" },
  { time: "20:44:17", price: "4.848", digit: "8" },
  { time: "20:44:16", price: "4.836", digit: "6" },
  { time: "20:44:15", price: "4.821", digit: "1" },
  { time: "20:44:14", price: "4.797", digit: "7" },
  { time: "20:44:13", price: "4.810", digit: "0" },
  { time: "20:44:12", price: "4.788", digit: "8" },
  { time: "20:44:11", price: "4.766", digit: "6" },
  { time: "20:44:10", price: "4.751", digit: "1" },
  { time: "20:44:09", price: "4.739", digit: "9" },
];

const digitHistory = [
  5, 5, 1, 8, 4, 1, 6, 2, 9, 3, 7, 1, 0, 8, 5, 4, 6, 1, 3, 8, 7, 0, 2, 1, 9, 4, 7, 5, 1, 6, 8, 3, 0, 4, 5, 7, 2, 1, 9, 8,
];

const recoverySteps = ["×1", "×1.5", "×2", "×3", "×5"];

function Dashboard() {
  const [isDark, setIsDark] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [mode, setMode] = useState("digit-match");
  const [symbol, setSymbol] = useState("Volatility 100 (1s) Index");
  const [multiplier, setMultiplier] = useState("×1.5");
  const [profitTargetEnabled, setProfitTargetEnabled] = useState(true);
  const [stopLossEnabled, setStopLossEnabled] = useState(true);
  const [notifyEnabled, setNotifyEnabled] = useState(true);
  const [selectedTab, setSelectedTab] = useState("trades");
  const [authView, setAuthView] = useState<"signin" | "signup" | null>(null);
  const [notice, setNotice] = useState("");
  const [mobileMenu, setMobileMenu] = useState(false);

  function showNotice(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 3800);
  }

  function handleAccountSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthView(null);
    showNotice("Account access is a preview. Sign-in is not connected yet.");
  }

  return (
    <div className={isDark ? "dark min-h-screen bg-background text-foreground" : "min-h-screen bg-background text-foreground"}>
      <div className="min-h-screen">
        <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur-sm">
          <div className="mx-auto flex h-[68px] max-w-[1760px] items-center justify-between gap-3 px-4 sm:px-6 xl:px-8">
            <div className="flex min-w-0 items-center gap-3">
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0 lg:hidden"
                aria-label="Toggle navigation"
                onClick={() => setMobileMenu(!mobileMenu)}
              >
                {mobileMenu ? <X /> : <Menu />}
              </Button>
              <a href="#workspace" className="flex min-w-0 items-center gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground">
                  <Disc3 className="size-[19px]" strokeWidth={2.25} />
                </span>
                <span className="truncate text-[15px] font-extrabold tracking-normal">OverUnderAuto</span>
              </a>
              <span className="hidden h-7 w-px bg-border sm:block" />
              <span className="hidden items-center gap-2 text-sm text-muted-foreground sm:flex">
                <LayoutDashboard className="size-4" /> Workspace
              </span>
            </div>

            <div className="flex shrink-0 items-center gap-2 sm:gap-3">
              <div className="hidden items-center gap-2 rounded-md border border-border bg-card px-3 py-2 sm:flex">
                <span className="size-2 rounded-full bg-amber-500" />
                <span className="text-xs font-semibold text-muted-foreground">Preview only</span>
              </div>
              <Button variant="ghost" size="icon" aria-label="Notifications" onClick={() => showNotice("You’re all caught up.")}>
                <Bell />
              </Button>
              <Button
                variant="outline"
                size="icon"
                aria-label={isDark ? "Switch to light appearance" : "Switch to dark appearance"}
                onClick={() => setIsDark(!isDark)}
              >
                {isDark ? <Sun /> : <Moon />}
              </Button>
              <div className="hidden items-center gap-2 md:flex">
                <Button variant="ghost" size="sm" onClick={() => setAuthView("signin")}>Sign in</Button>
                <Button size="sm" onClick={() => setAuthView("signup")}>Create account</Button>
              </div>
              <Button className="md:hidden" size="sm" onClick={() => setAuthView("signin")}>Sign in</Button>
            </div>
          </div>
          {mobileMenu && (
            <nav className="flex flex-col gap-1 border-t border-border bg-background px-4 py-3 lg:hidden">
              <a className="rounded-md bg-accent px-3 py-2 text-sm font-semibold text-accent-foreground" href="#workspace" onClick={() => setMobileMenu(false)}>Strategy workspace</a>
              <a className="rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-muted" href="#history" onClick={() => setMobileMenu(false)}>Trade history</a>
              <a className="rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-muted" href="#risk" onClick={() => setMobileMenu(false)}>Risk settings</a>
            </nav>
          )}
        </header>

        <main id="workspace" className="mx-auto max-w-[1760px] px-4 py-6 sm:px-6 lg:py-8 xl:px-8">
          <div className="mb-7 grid grid-cols-[minmax(0,1fr)_auto] items-end gap-4 sm:flex sm:flex-wrap sm:items-center sm:justify-between">
            <div className="min-w-0 dashboard-enter">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-[0.12em] text-brand">Strategy desk</span>
                <Badge variant="outline" className="rounded-sm border-border bg-card font-medium text-muted-foreground">UI preview</Badge>
              </div>
              <h1 className="text-2xl font-bold leading-tight sm:text-[30px]">Good evening</h1>
              <p className="mt-1 text-sm text-muted-foreground">Your digit strategy, at a glance.</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button variant="outline" size="sm" className="hidden sm:inline-flex" onClick={() => showNotice("Session saved in this preview.")}>
                <Copy /> Save session
              </Button>
              <Button
                size="sm"
                className="h-10 px-4 sm:h-9"
                onClick={() => {
                  setIsRunning(!isRunning);
                  if (!isRunning) showNotice("Preview mode only — no trades will be placed.");
                }}
              >
                {isRunning ? <Pause /> : <Play />}
                {isRunning ? "Pause preview" : "Start preview"}
              </Button>
              <Button variant="ghost" size="icon" aria-label="More actions" onClick={() => showNotice("More session options will appear here.")}>
                <MoreHorizontal />
              </Button>
            </div>
          </div>

          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-4">
            <Metric label="Session P/L" value="+$26.32" detail="Sample figure" tone="positive" />
            <Metric label="Win rate" value="66.7%" detail="2 wins · 1 loss" />
            <Metric label="Trades today" value="3" detail="Preview session" />
            <Metric label="Bot status" value={isRunning ? "Preview active" : "Ready to review"} detail="Deriv not connected" status />
          </div>

          <div className="grid gap-5 xl:grid-cols-[minmax(250px,300px)_minmax(0,1fr)_minmax(235px,270px)]">
            <aside className="flex flex-col gap-5 dashboard-enter">
              <section className="rounded-lg border border-border bg-card p-4 sm:p-5">
                <SectionHeading title="Connection" note="PREVIEW" />
                <div className="mt-4 rounded-md border border-border bg-background p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">Deriv account</p>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">Connect with Deriv Auth 2.0 when setup is ready.</p>
                    </div>
                    <span className="mt-1 size-2 shrink-0 rounded-full bg-amber-500" />
                  </div>
                </div>
                <Button variant="outline" className="mt-3 w-full" onClick={() => showNotice("Deriv sign-in will be connected in a later setup step.")}>
                  Connect Deriv
                  <ArrowUpRight />
                </Button>
                <div className="mt-4 flex items-center justify-between border-t border-border pt-4 text-sm">
                  <span className="text-muted-foreground">Account type</span>
                  <Badge variant="secondary" className="rounded-sm">Demo</Badge>
                </div>
              </section>

              <section className="rounded-lg border border-border bg-card p-4 sm:p-5">
                <SectionHeading title="Strategy" note="CONFIGURATION" />
                <div className="mt-4 space-y-4">
                  <Field label="Trading strategy">
                    <Select value={mode} onValueChange={setMode}>
                      <SelectTrigger aria-label="Trading strategy"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="digit-match">Last digit · Over / Under</SelectItem>
                        <SelectItem value="digit-differ">Last digit · Differs</SelectItem>
                        <SelectItem value="digit-even">Last digit · Even / Odd</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Market">
                    <Select value={symbol} onValueChange={setSymbol}>
                      <SelectTrigger aria-label="Market"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Volatility 10 (1s) Index">Volatility 10 (1s)</SelectItem>
                        <SelectItem value="Volatility 25 (1s) Index">Volatility 25 (1s)</SelectItem>
                        <SelectItem value="Volatility 50 (1s) Index">Volatility 50 (1s)</SelectItem>
                        <SelectItem value="Volatility 75 (1s) Index">Volatility 75 (1s)</SelectItem>
                        <SelectItem value="Volatility 100 (1s) Index">Volatility 100 (1s)</SelectItem>
                        <SelectItem value="Volatility 100 Index">Volatility 100</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Base stake">
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
                        <Input className="pl-7 numeric" aria-label="Base stake" type="number" defaultValue="1.00" min="0" step="0.1" />
                      </div>
                    </Field>
                    <Field label="Duration">
                      <Select defaultValue="1">
                        <SelectTrigger aria-label="Duration"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="1">1 tick</SelectItem>
                          <SelectItem value="2">2 ticks</SelectItem>
                          <SelectItem value="5">5 ticks</SelectItem>
                          <SelectItem value="10">10 ticks</SelectItem>
                        </SelectContent>
                      </Select>
                    </Field>
                  </div>
                  <div className="rounded-md bg-brand-soft p-3">
                    <p className="text-xs font-bold uppercase tracking-[0.08em] text-brand">Entry rule</p>
                    <p className="mt-1.5 text-sm leading-5 text-foreground">A last digit of <span className="numeric font-semibold">0</span> or <span className="numeric font-semibold">1</span> signals <span className="font-bold text-brand">Over 1</span>.</p>
                    <p className="mt-2 text-xs leading-[1.6] text-muted-foreground">After a loss: switch to Under 8 until a win, then analyze again.</p>
                  </div>
                </div>
              </section>

              <section id="risk" className="rounded-lg border border-border bg-card p-4 sm:p-5">
                <SectionHeading title="Risk limits" note="YOUR GUARDRAILS" />
                <div className="mt-4 space-y-4">
                  <RiskInput label="Take profit" enabled={profitTargetEnabled} setEnabled={setProfitTargetEnabled} value="25.00" />
                  <RiskInput label="Stop loss" enabled={stopLossEnabled} setEnabled={setStopLossEnabled} value="10.00" />
                  <div>
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold">Recovery multiplier</span>
                      <Badge variant="outline" className="rounded-sm font-medium">Recovery on loss</Badge>
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
                          {step}
                        </Button>
                      ))}
                    </div>
                    <p className="mt-2 text-xs leading-5 text-muted-foreground">Current setting: {multiplier} of the previous stake.</p>
                  </div>
                </div>
              </section>
            </aside>

            <div className="flex min-w-0 flex-col gap-5">
              <div className="grid gap-5 2xl:grid-cols-[minmax(0,1.2fr)_minmax(300px,0.8fr)]">
                <section className="min-w-0 rounded-lg border border-border bg-card p-4 sm:p-5 dashboard-enter-delay">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <SectionHeading title="Last digit" note="SAMPLE FEED" />
                      <p className="mt-2 text-xs text-muted-foreground">{symbol}</p>
                    </div>
                    <Badge variant="outline" className="rounded-sm border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300">Not live</Badge>
                  </div>
                  <div className="mt-6 grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3">
                    <div className="flex items-end gap-4">
                      <span className="numeric text-[84px] font-medium leading-[0.85] text-brand sm:text-[96px]">1</span>
                      <div className="pb-1">
                        <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-muted-foreground">Latest digit</p>
                        <p className="numeric mt-1 text-sm font-medium">From 4.551</p>
                      </div>
                    </div>
                    <div className="pb-1 text-right">
                      <p className="text-xs text-muted-foreground">Sample price</p>
                      <p className="numeric mt-1 text-xl font-semibold">4.551</p>
                    </div>
                  </div>
                  <div className="mt-6 grid grid-cols-10 gap-1.5 sm:gap-2" aria-label="Sample digit history">
                    {digitHistory.map((digit, index) => (
                      <span
                        key={`${digit}-${index}`}
                        className={`numeric grid aspect-square min-w-0 place-items-center rounded-[4px] text-xs font-semibold sm:text-sm ${index === digitHistory.length - 1 ? "bg-brand text-primary-foreground" : index === digitHistory.length - 4 ? "bg-positive-soft text-positive" : "bg-background text-muted-foreground"}`}
                      >
                        {digit}
                      </span>
                    ))}
                  </div>
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-xs">
                    <span className="text-muted-foreground">Entry signal</span>
                    <span className="flex items-center gap-2 font-semibold text-brand"><span className="size-1.5 rounded-full bg-positive" /> Over 1 · sample only</span>
                  </div>
                </section>

                <section className="min-w-0 rounded-lg border border-border bg-card p-4 sm:p-5 dashboard-enter-delay">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <SectionHeading title="Market movement" note="SAMPLE DATA" />
                      <p className="mt-2 flex items-center gap-1.5 text-sm font-semibold"><TrendingUp className="size-4 text-positive" /> 4.551 <span className="text-xs font-medium text-positive">+0.84%</span></p>
                    </div>
                    <Select defaultValue="1m">
                      <SelectTrigger className="h-8 w-[78px] text-xs" aria-label="Chart time range"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1m">1 min</SelectItem>
                        <SelectItem value="5m">5 min</SelectItem>
                        <SelectItem value="15m">15 min</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="mt-5 h-[158px] w-full" role="img" aria-label="Illustrative market line chart">
                    <svg className="h-full w-full overflow-visible" viewBox="0 0 440 160" preserveAspectRatio="none">
                      <g className="market-grid">
                        <line x1="0" y1="20" x2="440" y2="20" />
                        <line x1="0" y1="60" x2="440" y2="60" />
                        <line x1="0" y1="100" x2="440" y2="100" />
                        <line x1="0" y1="140" x2="440" y2="140" />
                      </g>
                      <path className="market-line" d="M0 114 C17 108, 21 74, 42 87 S74 128, 92 102 S122 46, 142 69 S171 88, 188 60 S216 76, 231 92 S259 104, 278 69 S305 42, 321 60 S345 112, 362 85 S389 35, 405 52 S429 37, 440 22" />
                      <circle className="market-point" cx="440" cy="22" r="4" />
                    </svg>
                  </div>
                  <div className="mt-3 flex justify-between text-[10px] text-muted-foreground numeric"><span>20:43:20</span><span>20:43:45</span><span>20:44:10</span><span>20:44:18</span></div>
                </section>
              </div>

              <section className="min-w-0 rounded-lg border border-border bg-card dashboard-enter-delay">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
                  <Tabs value={selectedTab} onValueChange={setSelectedTab}>
                    <TabsList className="h-9 bg-muted p-1">
                      <TabsTrigger value="trades" className="h-7 px-3 text-xs"><LayoutDashboard className="mr-1.5 size-3.5" />Trade log</TabsTrigger>
                      <TabsTrigger value="history" className="h-7 px-3 text-xs"><History className="mr-1.5 size-3.5" />History</TabsTrigger>
                    </TabsList>
                  </Tabs>
                  <Button variant="outline" size="sm" className="h-8" onClick={() => showNotice("Trade records are sample data in this preview.")}>Export log</Button>
                </div>
                <Tabs value={selectedTab} onValueChange={setSelectedTab}>
                  <TabsContent value="trades" className="m-0">
                    <TradeTable />
                  </TabsContent>
                  <TabsContent value="history" className="m-0">
                    <TradeTable history />
                  </TabsContent>
                </Tabs>
              </section>

              <section className="rounded-lg border border-border bg-card p-4 sm:p-5">
                <div className="flex items-center justify-between gap-3">
                  <SectionHeading title="Recent ticks" note="SAMPLE STREAM" />
                  <span className="flex items-center gap-2 text-xs text-muted-foreground"><Clock3 className="size-3.5" />Last 10</span>
                </div>
                <div className="mt-4 grid grid-cols-[1fr_1fr_52px] gap-x-4 border-b border-border pb-2 text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                  <span>Time</span><span className="text-right">Price</span><span className="text-right">Digit</span>
                </div>
                <div className="divide-y divide-border">
                  {tickPrices.slice(0, 5).map((tick, index) => (
                    <div key={tick.time} className="grid grid-cols-[1fr_1fr_52px] items-center gap-x-4 py-2.5 text-sm">
                      <span className="numeric text-xs text-muted-foreground">{tick.time}</span>
                      <span className="numeric text-right">{tick.price}</span>
                      <span className={`numeric text-right font-semibold ${index === 0 ? "text-brand" : "text-muted-foreground"}`}>{tick.digit}</span>
                    </div>
                  ))}
                </div>
              </section>
            </div>

            <aside className="flex min-w-0 flex-col gap-5 dashboard-enter-delay">
              <section className="rounded-lg border border-border bg-card p-4 sm:p-5">
                <SectionHeading title="Session" note="SAMPLE" />
                <div className="mt-4 rounded-md bg-positive-soft p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold uppercase tracking-[0.1em] text-muted-foreground">Net P/L</span>
                    <Badge variant="outline" className="rounded-sm border-positive/30 bg-card font-semibold text-positive">Sample</Badge>
                  </div>
                  <p className="numeric mt-3 text-3xl font-medium text-positive">+$26.32 <span className="text-xs font-medium">USD</span></p>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2.5">
                  <SmallMetric label="Wins" value="2" positive />
                  <SmallMetric label="Losses" value="1" />
                  <SmallMetric label="Trades" value="3" />
                  <SmallMetric label="Win rate" value="66.7%" />
                </div>
              </section>

              <section className="rounded-lg border border-border bg-card p-4 sm:p-5">
                <div className="flex items-center justify-between gap-3">
                  <SectionHeading title="Bot details" note="CURRENT SETUP" />
                  <Button variant="ghost" size="icon" className="size-8" aria-label="About strategy" onClick={() => showNotice("Strategy logic is a visual placeholder until implementation begins.")}><CircleHelp /></Button>
                </div>
                <dl className="mt-4 space-y-3.5">
                  <DetailRow label="Status" value={isRunning ? "Preview active" : "Idle"} />
                  <DetailRow label="Market" value={symbol.replace(" Index", "")} />
                  <DetailRow label="Entry trigger" value="Digit 0 or 1" />
                  <DetailRow label="First direction" value="Over 1" />
                  <DetailRow label="After a loss" value="Under 8" />
                  <DetailRow label="Recovery" value={multiplier} />
                </dl>
                <div className="mt-4 flex items-start gap-2 rounded-md border border-border bg-background p-3">
                  <ShieldCheck className="mt-0.5 size-4 shrink-0 text-brand" />
                  <p className="text-xs leading-[1.6] text-muted-foreground">Sample values only. No account is connected and no trades are placed.</p>
                </div>
              </section>

              <section className="rounded-lg border border-border bg-card p-4 sm:p-5">
                <SectionHeading title="Preferences" note="DISPLAY" />
                <div className="mt-3 divide-y divide-border">
                  <SettingRow label="Trade alerts" description="In-app notifications" checked={notifyEnabled} onCheckedChange={setNotifyEnabled} />
                  <div className="flex items-center justify-between gap-3 py-3">
                    <div><p className="text-sm font-medium">Appearance</p><p className="mt-0.5 text-xs text-muted-foreground">{isDark ? "Dark" : "Light"} mode</p></div>
                    <Button variant="outline" size="icon" aria-label="Toggle appearance" onClick={() => setIsDark(!isDark)}>{isDark ? <Sun /> : <Moon />}</Button>
                  </div>
                </div>
              </section>

              <p className="px-1 text-[11px] leading-[1.6] text-muted-foreground">Trading involves risk. This interface is a design preview, not financial advice or a connected trading service.</p>
            </aside>
          </div>
        </main>

        <footer className="border-t border-border">
          <div className="mx-auto flex max-w-[1760px] flex-wrap items-center justify-between gap-2 px-4 py-4 text-xs text-muted-foreground sm:px-6 xl:px-8">
            <span>OverUnderAuto <span className="mx-1.5">·</span> Preview workspace</span>
            <span className="flex items-center gap-2"><span className="size-1.5 rounded-full bg-amber-500" />Not connected to Deriv</span>
          </div>
        </footer>

        {notice && (
          <div role="status" className="fixed bottom-4 left-1/2 z-50 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-2 rounded-md border border-border bg-popover px-4 py-3 text-sm text-popover-foreground shadow-lg">
            <span className="size-2 shrink-0 rounded-full bg-brand" />{notice}
            <Button size="icon" variant="ghost" className="-mr-2 size-7" aria-label="Dismiss message" onClick={() => setNotice("")}><X /></Button>
          </div>
        )}

        <Dialog open={authView !== null} onOpenChange={(open) => !open && setAuthView(null)}>
          <DialogContent className="max-w-[420px]">
            <DialogHeader>
              <DialogTitle className="text-left">{authView === "signup" ? "Create your account" : "Welcome back"}</DialogTitle>
              <DialogDescription className="text-left">{authView === "signup" ? "Set up an OverUnderAuto account." : "Sign in to your OverUnderAuto account."}</DialogDescription>
            </DialogHeader>
            <form className="mt-3 space-y-4" onSubmit={handleAccountSubmit}>
              {authView === "signup" && <Field label="Name"><Input placeholder="Your name" autoComplete="name" required /></Field>}
              <Field label="Email address"><Input type="email" placeholder="you@example.com" autoComplete="email" required /></Field>
              <Field label="Password"><Input type="password" placeholder="At least 8 characters" autoComplete={authView === "signup" ? "new-password" : "current-password"} minLength={8} required /></Field>
              <div className="rounded-md bg-muted px-3 py-2.5 text-xs leading-[1.6] text-muted-foreground">Account access is a visual preview. Authentication has not been connected.</div>
              <Button type="submit" className="w-full">{authView === "signup" ? "Create account" : "Sign in"}</Button>
              <p className="text-center text-sm text-muted-foreground">
                {authView === "signup" ? "Already have an account?" : "New to OverUnderAuto?"}{" "}
                <button type="button" className="font-semibold text-brand underline-offset-4 hover:underline" onClick={() => setAuthView(authView === "signup" ? "signin" : "signup")}>
                  {authView === "signup" ? "Sign in" : "Create account"}
                </button>
              </p>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}

function SectionHeading({ title, note }: { title: string; note?: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <h2 className="truncate text-sm font-bold">{title}</h2>
      {note && <span className="shrink-0 text-[9px] font-bold tracking-[0.1em] text-muted-foreground">{note}</span>}
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

function Metric({ label, value, detail, tone, status }: { label: string; value: string; detail: string; tone?: "positive"; status?: boolean }) {
  return (
    <section className="min-w-0 rounded-lg border border-border bg-card px-3.5 py-3.5 sm:px-4 sm:py-4">
      <p className="truncate text-xs font-semibold text-muted-foreground">{label}</p>
      <p className={`mt-2 truncate text-lg font-bold sm:text-xl ${tone === "positive" ? "text-positive numeric" : ""}`}>{status && <span className="mr-2 inline-block size-2 rounded-full bg-amber-500 align-middle" />}{value}</p>
      <p className="mt-1 truncate text-[11px] text-muted-foreground">{detail}</p>
    </section>
  );
}

function SmallMetric({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
  return (
    <div className="min-w-0 rounded-md border border-border bg-background px-3 py-3">
      <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground">{label}</p>
      <p className={`numeric mt-1 text-xl font-medium ${positive ? "text-positive" : "text-foreground"}`}>{value}</p>
    </div>
  );
}

function RiskInput({ label, enabled, setEnabled, value }: { label: string; enabled: boolean; setEnabled: (value: boolean) => void; value: string }) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="text-xs font-semibold">{label}</span>
        <Switch aria-label={`${label} limit enabled`} checked={enabled} onCheckedChange={setEnabled} />
      </div>
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
        <Input className="pl-7 numeric" type="number" min="0" step="0.5" defaultValue={value} aria-label={`${label} amount`} disabled={!enabled} />
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

function SettingRow({ label, description, checked, onCheckedChange }: { label: string; description: string; checked: boolean; onCheckedChange: (value: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-3 py-3">
      <div className="min-w-0"><p className="text-sm font-medium">{label}</p><p className="mt-0.5 text-xs text-muted-foreground">{description}</p></div>
      <Switch aria-label={label} checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}

function TradeTable({ history = false }: { history?: boolean }) {
  const trades = history
    ? [
        { run: "#18", time: "20:40:52", entry: "6", target: "Over 1", exit: "—", stake: "$1.50", status: "Preview", pnl: "—" },
        { run: "#17", time: "20:40:26", entry: "1", target: "Over 1", exit: "2", stake: "$1.00", status: "Sample win", pnl: "+$0.82" },
        { run: "#16", time: "20:40:04", entry: "0", target: "Over 1", exit: "4", stake: "$1.00", status: "Sample loss", pnl: "−$1.00" },
      ]
    : [
        { run: "#03", time: "20:44:18", entry: "1", target: "Over 1", exit: "—", stake: "$1.00", status: "Preview", pnl: "—" },
        { run: "#02", time: "20:40:26", entry: "1", target: "Over 1", exit: "2", stake: "$1.00", status: "Sample win", pnl: "+$0.82" },
        { run: "#01", time: "20:40:04", entry: "0", target: "Over 1", exit: "4", stake: "$1.00", status: "Sample loss", pnl: "−$1.00" },
      ];

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[700px] border-collapse text-left text-xs">
        <thead><tr className="border-b border-border text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
          <th className="px-4 py-3 font-semibold sm:px-5">Run</th><th className="px-3 py-3 font-semibold">Time</th><th className="px-3 py-3 font-semibold">Entry</th><th className="px-3 py-3 font-semibold">Contract</th><th className="px-3 py-3 font-semibold">Exit</th><th className="px-3 py-3 font-semibold">Stake</th><th className="px-3 py-3 font-semibold">Status</th><th className="px-4 py-3 text-right font-semibold sm:px-5">P/L</th>
        </tr></thead>
        <tbody className="divide-y divide-border">{trades.map((trade) => (
          <tr key={trade.run} className="hover:bg-muted/40">
            <td className="numeric px-4 py-3.5 font-medium sm:px-5">{trade.run}</td><td className="numeric px-3 py-3.5 text-muted-foreground">{trade.time}</td><td className="numeric px-3 py-3.5">{trade.entry}</td><td className="px-3 py-3.5">{trade.target}</td><td className="numeric px-3 py-3.5">{trade.exit}</td><td className="numeric px-3 py-3.5">{trade.stake}</td>
            <td className="px-3 py-3.5"><Badge variant="outline" className={`rounded-sm whitespace-nowrap font-medium ${trade.status === "Sample win" ? "border-positive/30 bg-positive-soft text-positive" : trade.status === "Sample loss" ? "border-destructive/30 text-destructive" : "text-muted-foreground"}`}>{trade.status}</Badge></td>
            <td className={`numeric px-4 py-3.5 text-right font-semibold sm:px-5 ${trade.pnl.startsWith("+") ? "text-positive" : ""}`}>{trade.pnl}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}