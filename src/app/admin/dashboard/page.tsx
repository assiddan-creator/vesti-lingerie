"use client";

import Image from "next/image";
import { useCallback, useState } from "react";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";

type Section = "overview" | "products" | "analytics" | "settings";

const navItems: Array<{ id: Section; label: string; icon: string }> = [
  { id: "overview", label: "Overview", icon: "◉" },
  { id: "products", label: "Products", icon: "▤" },
  { id: "analytics", label: "Analytics", icon: "◈" },
  { id: "settings", label: "Settings", icon: "⚙" },
];

const stats = [
  {
    label: "Total Try-Ons",
    value: "12,450",
    delta: "+12.4%",
    deltaPositive: true,
    hint: "vs. last 30 days",
  },
  {
    label: "Click-Through Rate",
    value: "4.2%",
    delta: "+0.6%",
    deltaPositive: true,
    hint: "storewide average",
  },
  {
    label: "Active Products",
    value: "85",
    delta: "+3",
    deltaPositive: true,
    hint: "linked to try-on",
  },
] as const;

const topItems = [
  {
    id: "1",
    name: "Oversized Wool Coat — Charcoal",
    category: "Outerwear",
    tryOns: 1842,
  },
  {
    id: "2",
    name: "Silk Slip Dress — Noir",
    category: "Dresses",
    tryOns: 1296,
  },
  {
    id: "3",
    name: "Tailored Trousers — Stone",
    category: "Bottoms",
    tryOns: 1103,
  },
  {
    id: "4",
    name: "Merino Crew — Ivory",
    category: "Knitwear",
    tryOns: 876,
  },
  {
    id: "5",
    name: "Leather Chelsea — Black",
    category: "Footwear",
    tryOns: 654,
  },
] as const;

/** Last 7 days — mock trend series */
const trendForecastData = [
  { day: "Mon", tryOns: 1180, addToCart: 412 },
  { day: "Tue", tryOns: 1320, addToCart: 468 },
  { day: "Wed", tryOns: 1245, addToCart: 441 },
  { day: "Thu", tryOns: 1510, addToCart: 520 },
  { day: "Fri", tryOns: 1688, addToCart: 602 },
  { day: "Sat", tryOns: 1892, addToCart: 710 },
  { day: "Sun", tryOns: 1615, addToCart: 589 },
] as const;

const fitPreferenceMix = [
  { label: "Slim", pct: 15 },
  { label: "Regular", pct: 20 },
  { label: "Oversize", pct: 65 },
] as const;

const sectionTitles: Record<Section, { title: string; subtitle: string }> = {
  overview: { title: "Overview", subtitle: "Performance snapshot · last 30 days" },
  products: { title: "Products", subtitle: "Catalog and try-on linkage" },
  analytics: { title: "Analytics", subtitle: "Funnels and cohorts" },
  settings: { title: "Settings", subtitle: "Store and billing" },
};

function csvEscapeCell(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function exportToCSV(): void {
  const rows: string[] = [];
  rows.push([csvEscapeCell("Report"), csvEscapeCell("Vesti Lingerie inventory report")].join(","));
  rows.push([csvEscapeCell("Generated"), csvEscapeCell(new Date().toISOString())].join(","));
  rows.push("");

  rows.push(csvEscapeCell("Summary metrics"));
  rows.push([csvEscapeCell("Metric"), csvEscapeCell("Value"), csvEscapeCell("Delta"), csvEscapeCell("Hint")].join(","));
  for (const s of stats) {
    rows.push(
      [csvEscapeCell(s.label), csvEscapeCell(s.value), csvEscapeCell(s.delta), csvEscapeCell(s.hint)].join(","),
    );
  }
  rows.push("");

  rows.push(csvEscapeCell("Trend & demand (last 7 days)"));
  rows.push([csvEscapeCell("Day"), csvEscapeCell("Virtual try-ons"), csvEscapeCell("Add to cart")].join(","));
  for (const d of trendForecastData) {
    rows.push([csvEscapeCell(d.day), String(d.tryOns), String(d.addToCart)].join(","));
  }
  rows.push("");

  rows.push(csvEscapeCell("Size Finder — fit preference mix"));
  rows.push([csvEscapeCell("Preference"), csvEscapeCell("Share %")].join(","));
  for (const f of fitPreferenceMix) {
    rows.push([csvEscapeCell(f.label), String(f.pct)].join(","));
  }
  rows.push("");

  rows.push(csvEscapeCell("Inventory insights"));
  rows.push([csvEscapeCell("Signal"), csvEscapeCell("Details")].join(","));
  rows.push(
    [
      csvEscapeCell("Most requested size missing from stock"),
      csvEscapeCell("L — sessions outpaced on-hand units by 38% this week"),
    ].join(","),
  );
  rows.push("");

  rows.push(csvEscapeCell("Top performing items"));
  rows.push(
    [csvEscapeCell("Rank"), csvEscapeCell("Product name"), csvEscapeCell("Category"), csvEscapeCell("Total try-ons")].join(
      ",",
    ),
  );
  topItems.forEach((item, i) => {
    rows.push(
      [String(i + 1), csvEscapeCell(item.name), csvEscapeCell(item.category), String(item.tryOns)].join(","),
    );
  });

  const csv = rows.join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "vesti_inventory_report.csv";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function MerchantDashboardPage() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [section, setSection] = useState<Section>("overview");

  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  const go = useCallback((id: Section) => {
    setSection(id);
    setSidebarOpen(false);
  }, []);

  return (
    <div className="relative min-h-screen bg-black text-white">
      <div className="pointer-events-none fixed inset-0 z-0">
        <Image
          src="/Replace_products_with_202604030606.jpeg"
          alt=""
          fill
          className="object-cover object-center opacity-[0.12]"
          sizes="100vw"
          priority={false}
        />
        <div className="absolute inset-0 bg-gradient-to-br from-black via-black to-black" />
      </div>

      {sidebarOpen && (
        <button
          type="button"
          aria-label="Close menu"
          className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm lg:hidden"
          onClick={closeSidebar}
        />
      )}

      <aside
        className={`fixed left-0 top-0 z-50 flex h-full w-[min(18rem,88vw)] flex-col border-r border-white/[0.08] bg-black/55 shadow-[inset_-1px_0_0_rgba(255,255,255,0.04)] backdrop-blur-xl transition-transform duration-300 ease-out lg:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        }`}
      >
        <div className="flex items-center justify-between gap-3 border-b border-white/[0.08] px-5 py-5">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-[#FF2800]">Merchant</p>
            <p className="mt-1 text-lg font-semibold tracking-tight text-white">Vesti Lingerie</p>
          </div>
          <button
            type="button"
            className="rounded-lg border border-white/15 bg-white/[0.06] p-2 text-white/80 backdrop-blur-sm lg:hidden"
            onClick={closeSidebar}
            aria-label="Close navigation"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <nav className="flex flex-1 flex-col gap-1 p-3" aria-label="Dashboard">
          {navItems.map((item) => {
            const active = section === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => go(item.id)}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-medium transition-colors ${
                  active
                    ? "border border-[#FF2800]/35 bg-[#FF2800]/12 text-white shadow-[0_0_24px_rgba(255,40,0,0.12)]"
                    : "border border-transparent text-white/60 hover:border-white/10 hover:bg-white/[0.05] hover:text-white"
                }`}
              >
                <span className="text-base opacity-80" aria-hidden>
                  {item.icon}
                </span>
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="border-t border-white/[0.08] p-4">
          <p className="text-[11px] leading-relaxed text-white/35">Merchant dashboard · mock data</p>
        </div>
      </aside>

      <div className="relative z-10 flex min-h-screen flex-1 flex-col lg:pl-[min(18rem,88vw)]">
        <header className="sticky top-0 z-30 flex items-center justify-between gap-4 border-b border-white/[0.08] bg-black/80 px-4 py-4 backdrop-blur-md sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              className="shrink-0 rounded-xl border border-white/15 bg-white/[0.06] p-2.5 text-white/90 backdrop-blur-sm lg:hidden"
              onClick={() => setSidebarOpen(true)}
              aria-label="Open navigation"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
              </svg>
            </button>
            <div className="min-w-0">
              <h1 className="truncate text-lg font-semibold tracking-tight text-white sm:text-xl">
                {sectionTitles[section].title}
              </h1>
              <p className="truncate text-xs text-white/45 sm:text-sm">{sectionTitles[section].subtitle}</p>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 sm:gap-3">
            <button
              type="button"
              onClick={() => exportToCSV()}
              className="rounded-xl border border-[#FF2800]/35 bg-black/45 px-3.5 py-2 text-center text-xs font-semibold uppercase tracking-[0.15em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-md transition-[border,box-shadow,background-color] hover:border-[#FF2800]/60 hover:bg-[#FF2800]/10 hover:shadow-[0_0_24px_rgba(255,40,0,0.15)] sm:px-4 sm:py-2.5 sm:text-[11px] sm:tracking-[0.18em]"
            >
              Export Data
            </button>
            <span className="rounded-full border border-white/10 bg-white/[0.06] px-3 py-1.5 text-xs font-medium text-white/70 backdrop-blur-sm">
              Live
            </span>
          </div>
        </header>

        <main className="mx-auto w-full max-w-6xl flex-1 space-y-8 px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
          {section === "overview" && (
            <>
              <section aria-label="Key metrics">
                <div className="grid justify-items-center gap-4 sm:grid-cols-2 sm:justify-items-stretch xl:grid-cols-3">
                  {stats.map((s) => (
                    <div
                      key={s.label}
                      className="w-full max-w-md rounded-2xl border border-white/10 bg-black/45 p-5 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-md sm:max-w-none sm:p-6"
                    >
                      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#FF2800]/90">{s.label}</p>
                      <p className="mt-3 font-mono text-3xl font-bold tabular-nums tracking-tight text-white sm:text-4xl">
                        {s.value}
                      </p>
                      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.06] pt-4">
                        <span
                          className={`text-sm font-semibold tabular-nums ${
                            s.deltaPositive ? "text-white" : "text-[rgba(255,255,255,0.7)]"
                          }`}
                        >
                          {s.delta}
                        </span>
                        <span className="text-right text-[11px] text-white/40">{s.hint}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section aria-label="Trend and inventory insights" className="space-y-4">
                <p className="text-center text-xs font-semibold uppercase tracking-[0.28em] text-[#FF2800]/95">
                  Predictive signals
                </p>
                <div className="grid justify-items-center gap-4 lg:grid-cols-2 lg:items-stretch lg:justify-items-stretch lg:gap-6">
                  <div className="flex w-full max-w-xl flex-col rounded-2xl border border-white/10 bg-black/45 p-5 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-md sm:p-6 lg:max-w-none">
                    <div className="mb-4 flex flex-col items-center gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
                      <div className="text-center sm:text-left">
                        <h3 className="text-base font-semibold text-white">Trend &amp; demand forecasting</h3>
                        <p className="mt-1 text-sm text-[rgba(255,255,255,0.6)]">Virtual try-ons vs add to cart · last 7 days</p>
                      </div>
                      <div className="flex flex-wrap gap-4 text-[11px] font-medium uppercase tracking-widest text-white/40">
                        <span className="inline-flex items-center gap-2">
                          <span className="h-0.5 w-6 rounded-full bg-[#FF2800]" aria-hidden />
                          Try-ons
                        </span>
                        <span className="inline-flex items-center gap-2">
                          <span
                            className="h-0.5 w-6 rounded-full bg-white/45"
                            style={{ boxShadow: "0 0 12px rgba(255,255,255,0.15)" }}
                            aria-hidden
                          />
                          Add to cart
                        </span>
                      </div>
                    </div>
                    <div className="relative w-full min-w-0 min-h-[260px] sm:min-h-[280px]">
                      <ResponsiveContainer width="100%" height={280}>
                        <LineChart data={[...trendForecastData]} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                          <XAxis
                            dataKey="day"
                            tick={{ fill: "rgba(255,255,255,0.45)", fontSize: 11 }}
                            tickLine={false}
                            axisLine={{ stroke: "rgba(255,255,255,0.08)" }}
                            dy={8}
                          />
                          <Tooltip
                            cursor={{ stroke: "rgba(255,40,0,0.35)", strokeWidth: 1 }}
                            contentStyle={{
                              backgroundColor: "rgba(0, 0, 0, 0.92)",
                              border: "1px solid rgba(255,255,255,0.12)",
                              borderRadius: "12px",
                              boxShadow: "0 16px 48px rgba(0,0,0,0.45)",
                              backdropFilter: "blur(12px)",
                            }}
                            labelStyle={{
                              color: "rgba(255,255,255,0.6)",
                              fontSize: 10,
                              letterSpacing: "0.2em",
                              textTransform: "uppercase",
                              marginBottom: 6,
                            }}
                            itemStyle={{ fontSize: 13, paddingTop: 2, paddingBottom: 2 }}
                            formatter={(value) =>
                              typeof value === "number" ? value.toLocaleString() : String(value ?? "")
                            }
                          />
                          <Line
                            type="monotone"
                            dataKey="tryOns"
                            name="Virtual try-ons"
                            stroke="#FF2800"
                            strokeWidth={2.5}
                            dot={false}
                            activeDot={{ r: 5, fill: "#FF2800", stroke: "#000000", strokeWidth: 2 }}
                          />
                          <Line
                            type="monotone"
                            dataKey="addToCart"
                            name="Add to cart"
                            stroke="rgba(255, 255, 255, 0.55)"
                            strokeWidth={2}
                            dot={false}
                            activeDot={{ r: 4, fill: "#FFFFFF", stroke: "#000000", strokeWidth: 2 }}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  <div className="flex w-full max-w-xl flex-col rounded-2xl border border-white/10 bg-black/40 p-5 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] backdrop-blur-md sm:p-6 lg:max-w-none">
                    <h3 className="text-base font-semibold text-white">Inventory insights</h3>
                    <p className="mt-1 text-sm text-[rgba(255,255,255,0.6)]">From Size Finder demand signals · update stock before churn</p>

                    <div className="mt-6 space-y-5">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/50">Fit preference</p>
                        <div className="mt-3 space-y-3">
                          {fitPreferenceMix.map((row) => (
                            <div key={row.label}>
                              <div className="mb-1.5 flex justify-between text-xs text-white/70">
                                <span>{row.label}</span>
                                <span className="font-mono tabular-nums text-white/90">{row.pct}%</span>
                              </div>
                              <div className="h-2 overflow-hidden rounded-full bg-white/[0.06] ring-1 ring-white/[0.06]">
                                <div
                                  className="h-full rounded-full bg-gradient-to-r from-[#FF2800]/80 to-[#FF2800]"
                                  style={{ width: `${row.pct}%` }}
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                        <p className="mt-3 text-xs leading-relaxed text-[#FF2800]/90">
                          Oversize leads demand — widen loose cuts in outerwear &amp; knits.
                        </p>
                      </div>

                      <div className="rounded-xl border border-[#FF2800]/25 bg-[rgba(255,40,0,0.07)] px-4 py-3.5">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#FF2800]">
                          Stock gap alert
                        </p>
                        <p className="mt-2 text-sm font-medium text-white/95">
                          Most requested size missing from stock:{" "}
                          <span className="font-mono text-lg font-bold text-[#FF2800]">L</span>
                        </p>
                        <p className="mt-1.5 text-xs leading-relaxed text-white/45">
                          Size Finder sessions for L outpaced on-hand units by 38% this week — prioritize replenishment.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </section>

              <section
                aria-labelledby="top-items-heading"
                className="overflow-hidden rounded-2xl border border-white/10 bg-black/40 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] backdrop-blur-md"
              >
                <div className="flex flex-col gap-3 border-b border-white/[0.08] px-5 py-5 sm:flex-row sm:items-end sm:justify-between sm:px-6">
                  <div>
                    <h2 id="top-items-heading" className="text-base font-semibold text-white">
                      Top performing items
                    </h2>
                    <p className="mt-1 text-sm text-white/45">By total try-on sessions</p>
                  </div>
                  <button
                    type="button"
                    className="self-start rounded-lg border border-[#FF2800]/40 bg-[#FF2800]/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-widest text-[#FF2800] transition-colors hover:bg-[#FF2800]/18"
                  >
                    Export
                  </button>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-left text-sm">
                    <thead>
                      <tr className="border-b border-white/[0.06] text-[11px] font-semibold uppercase tracking-[0.18em] text-white/40">
                        <th className="px-5 py-3 sm:px-6">Product</th>
                        <th className="hidden py-3 sm:table-cell">Category</th>
                        <th className="py-3 text-right sm:px-6">Try-ons</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.05]">
                      {topItems.map((row, i) => (
                        <tr key={row.id} className="transition-colors hover:bg-white/[0.03]">
                          <td className="px-5 py-4 sm:px-6">
                            <div className="flex items-center gap-4">
                              <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-xl border border-white/10 bg-gradient-to-br from-white/[0.08] to-white/[0.02] ring-1 ring-white/[0.06]">
                                <div className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-white/25">
                                  {i + 1}
                                </div>
                              </div>
                              <div className="min-w-0">
                                <p className="truncate font-medium text-white/95">{row.name}</p>
                                <p className="mt-0.5 text-xs text-white/40 sm:hidden">{row.category}</p>
                              </div>
                            </div>
                          </td>
                          <td className="hidden py-4 text-white/55 sm:table-cell">{row.category}</td>
                          <td className="px-5 py-4 text-right font-mono tabular-nums text-white/90 sm:px-6">
                            {row.tryOns.toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}

          {section !== "overview" && (
            <section
              aria-label={sectionTitles[section].title}
              className="rounded-2xl border border-white/10 bg-black/40 p-8 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] backdrop-blur-md sm:p-10"
            >
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-[#FF2800]">Coming soon</p>
              <p className="mt-3 max-w-lg text-lg font-medium text-white/90">
                This section will host {sectionTitles[section].title.toLowerCase()} tools for your store.
              </p>
              <p className="mt-3 text-sm leading-relaxed text-white/45">
                Wire your API and permissions here as you expand the merchant experience.
              </p>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
