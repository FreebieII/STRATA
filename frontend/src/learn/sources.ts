// The official sources the Learn section cites: regulators, exchanges, the
// investor-protection fund, the index provider, the fund issuer and the
// broker. Nothing else is cited. Checked on 26 September 2026; rules and fees
// change, so each page is linked for the current version.

export type Source = {
  title: string;
  publisher: string;
  url: string;
};

// Only these sites may be cited (a test checks every link).
export const OFFICIAL_DOMAINS = [
  "investor.gov",
  "sec.gov",
  "finra.org",
  "cftc.gov",
  "ecfr.gov",
  "irs.gov",
  "nyse.com",
  "nasdaq.com",
  "nasdaqtrader.com",
  "cmegroup.com",
  "sipc.org",
  "ssga.com",
  "spglobal.com",
  "alpaca.markets",
] as const;

export const CHECKED_ON = "26 September 2026";

const GLOSSARY = "https://www.investor.gov/introduction-investing/investing-basics/glossary/";
const BULLETINS = "https://www.investor.gov/introduction-investing/general-resources/news-alerts/alerts-bulletins/";

export const SOURCES = {
  "investor-market-order": { title: "Market order", publisher: "Investor.gov (SEC)", url: `${GLOSSARY}market-order` },
  "investor-limit-order": { title: "Limit order", publisher: "Investor.gov (SEC)", url: `${GLOSSARY}limit-orders` },
  "investor-stop-order": { title: "Stop order", publisher: "Investor.gov (SEC)", url: `${GLOSSARY}stop-order` },
  "investor-order-types": {
    title: "Types of orders",
    publisher: "Investor.gov (SEC)",
    url: "https://www.investor.gov/introduction-investing/investing-basics/how-stock-markets-work/types-orders",
  },
  "investor-stop-bulletin": {
    title: "Stop, stop-limit, and trailing stop orders (investor bulletin)",
    publisher: "Investor.gov (SEC)",
    url: `${BULLETINS}investor-bulletins-15`,
  },
  "investor-spread": { title: "Bid-ask spread", publisher: "Investor.gov (SEC)", url: `${GLOSSARY}bid-ask-spread` },
  "investor-etf": { title: "Exchange-traded fund (ETF)", publisher: "Investor.gov (SEC)", url: `${GLOSSARY}exchange-traded-fund-etf` },
  "investor-index-fund": { title: "Index fund", publisher: "Investor.gov (SEC)", url: `${GLOSSARY}index-fund` },
  "investor-diversification": { title: "Diversification", publisher: "Investor.gov (SEC)", url: `${GLOSSARY}diversification` },
  "investor-liquidity": { title: "Liquidity (or marketability)", publisher: "Investor.gov (SEC)", url: `${GLOSSARY}liquidity-or-marketability` },
  "investor-margin": { title: "Margin account", publisher: "Investor.gov (SEC)", url: `${GLOSSARY}margin-account` },
  "investor-short": { title: "Short sales", publisher: "Investor.gov (SEC)", url: `${GLOSSARY}short-sales-0` },
  "investor-day-trading": { title: "Day trading", publisher: "Investor.gov (SEC)", url: `${GLOSSARY}day-trading` },
  "investor-dca": { title: "Dollar-cost averaging", publisher: "Investor.gov (SEC)", url: `${GLOSSARY}dollar-cost-averaging` },
  "investor-compound": { title: "Compound interest", publisher: "Investor.gov (SEC)", url: `${GLOSSARY}compound-interest` },
  "investor-circuit-breakers": {
    title: "Stock market circuit breakers",
    publisher: "Investor.gov (SEC)",
    url: `${GLOSSARY}stock-market-circuit-breakers`,
  },
  "investor-extended-hours": {
    title: "Extended-hours trading (investor bulletin)",
    publisher: "Investor.gov (SEC)",
    url: `${BULLETINS}investor-bulletins-42`,
  },
  "investor-mutual-funds-guide": {
    title: "Mutual funds and ETFs: a guide for investors",
    publisher: "SEC",
    url: "https://www.investor.gov/sites/investorgov/files/2019-02/mutual-funds-ETFs.pdf",
  },
  "investor-crypto-spotlight": {
    title: "Crypto assets",
    publisher: "Investor.gov (SEC)",
    url: "https://www.investor.gov/additional-resources/spotlight/crypto-assets",
  },
  "investor-t1": {
    title: "New T+1 settlement cycle: what investors need to know",
    publisher: "Investor.gov (SEC)",
    url: `${BULLETINS}investor-bulletins/new-t1-settlement-cycle-what-investors-need-know-investor-bulletin`,
  },
  "sec-t1": {
    title: "SEC finalizes rules to shorten the settlement cycle (press release 2023-29)",
    publisher: "SEC",
    url: "https://www.sec.gov/newsroom/press-releases/2023-29",
  },
  "sec-pdt-approval": {
    title: "Order approving FINRA's intraday margin amendments (Release 34-105226)",
    publisher: "SEC",
    url: "https://www.sec.gov/files/rules/sro/finra/2026/34-105226.pdf",
  },
  "finra-intraday-margin": {
    title: "Intraday margin requirements",
    publisher: "FINRA",
    url: "https://www.finra.org/investors/insights/intraday-margin-requirements",
  },
  "finra-notice-26-10": {
    title: "Regulatory Notice 26-10: effective date of the intraday margin rules",
    publisher: "FINRA",
    url: "https://www.finra.org/rules-guidance/notices/26-10",
  },
  "finra-4210": {
    title: "Rule 4210. Margin requirements",
    publisher: "FINRA",
    url: "https://www.finra.org/rules-guidance/rulebooks/finra-rules/4210",
  },
  "finra-taf": {
    title: "Trading activity fee",
    publisher: "FINRA",
    url: "https://www.finra.org/rules-guidance/guidance/trading-activity-fee",
  },
  "finra-2210": {
    title: "Rule 2210. Communications with the public",
    publisher: "FINRA",
    url: "https://www.finra.org/rules-guidance/rulebooks/finra-rules/2210",
  },
  "sec-section-31": {
    title: "Fee rate advisory 2026-2 (Section 31 fees)",
    publisher: "SEC",
    url: "https://www.sec.gov/rules-regulations/fee-rate-advisories/2026-2",
  },
  "sec-marketing": {
    title: "Marketing compliance: frequently asked questions",
    publisher: "SEC",
    url: "https://www.sec.gov/rules-regulations/staff-guidance/division-investment-management-frequently-asked-questions/marketing-compliance-frequently-asked-questions",
  },
  "ecfr-4-41": {
    title: "17 CFR 4.41: requirements for advertising (simulated results)",
    publisher: "CFTC rule, on eCFR",
    url: "https://www.ecfr.gov/current/title-17/chapter-I/part-4/subpart-D/section-4.41",
  },
  "cftc-virtual-currency": {
    title: "Understand the risks of virtual currency trading",
    publisher: "CFTC",
    url: "https://www.cftc.gov/LearnAndProtect/AdvisoriesAndArticles/understand_risks_of_virtual_currency.html",
  },
  "irs-p550": {
    title: "Publication 550: investment income and expenses (wash sales)",
    publisher: "IRS",
    url: "https://www.irs.gov/publications/p550",
  },
  "irs-digital-assets": { title: "Digital assets", publisher: "IRS", url: "https://www.irs.gov/filing/digital-assets" },
  "nyse-hours": { title: "Hours and calendars", publisher: "NYSE", url: "https://www.nyse.com/trade/hours-calendars" },
  "nyse-extended-hours": {
    title: "Extended hours trading",
    publisher: "NYSE",
    url: "https://www.nyse.com/extended-hours-trading",
  },
  "nasdaq-night-session": {
    title: "Equity trader alert 2026-46: the new trading hours",
    publisher: "Nasdaq",
    url: "https://www.nasdaqtrader.com/TraderNews.aspx?id=ETA2026-46",
  },
  "nasdaq-golden-cross": { title: "Golden cross", publisher: "Nasdaq", url: "https://www.nasdaq.com/glossary/g/golden-cross" },
  "nasdaq-death-cross": { title: "Death cross", publisher: "Nasdaq", url: "https://www.nasdaq.com/glossary/d/death-cross" },
  "cme-moving-averages": {
    title: "Understanding moving averages",
    publisher: "CME Group",
    url: "https://www.cmegroup.com/education/courses/technical-analysis/understanding-moving-averages",
  },
  "cme-oscillators": {
    title: "Oscillators: MACD, RSI, stochastics",
    publisher: "CME Group",
    url: "https://www.cmegroup.com/education/courses/technical-analysis/oscillators-macd-rsi-stochastics",
  },
  "sipc-protects": { title: "What SIPC protects", publisher: "SIPC", url: "https://www.sipc.org/for-investors/what-sipc-protects" },
  "ssga-spy": {
    title: "State Street SPDR S&P 500 ETF Trust (SPY)",
    publisher: "State Street",
    url: "https://www.ssga.com/us/en/intermediary/etfs/state-street-spdr-sp-500-etf-trust-spy",
  },
  "spdji-sp500": { title: "S&P 500", publisher: "S&P Dow Jones Indices", url: "https://www.spglobal.com/spdji/en/indices/equity/sp-500/" },
  "alpaca-paper": { title: "Paper trading", publisher: "Alpaca", url: "https://docs.alpaca.markets/us/docs/paper-trading" },
  "alpaca-orders": { title: "Orders at Alpaca", publisher: "Alpaca", url: "https://docs.alpaca.markets/us/docs/orders-at-alpaca" },
  "alpaca-fractional": { title: "Fractional trading", publisher: "Alpaca", url: "https://docs.alpaca.markets/us/docs/fractional-trading" },
  "alpaca-crypto": { title: "Crypto trading", publisher: "Alpaca", url: "https://docs.alpaca.markets/us/docs/crypto-trading-1" },
  "alpaca-crypto-fees": { title: "Crypto fees", publisher: "Alpaca", url: "https://docs.alpaca.markets/us/docs/crypto-fees" },
  "alpaca-regulatory-fees": {
    title: "Regulatory fees",
    publisher: "Alpaca",
    url: "https://docs.alpaca.markets/us/docs/regulatory-fees",
  },
  "alpaca-intraday-margin": {
    title: "The intraday margin rule",
    publisher: "Alpaca",
    url: "https://docs.alpaca.markets/us/docs/the-intraday-margin-rule",
  },
  "alpaca-24-5": { title: "24/5 trading", publisher: "Alpaca", url: "https://docs.alpaca.markets/us/docs/245-trading" },
  "alpaca-market-data": { title: "Market data FAQ", publisher: "Alpaca", url: "https://docs.alpaca.markets/us/docs/market-data-faq" },
} satisfies Record<string, Source>;

export type SourceId = keyof typeof SOURCES;
