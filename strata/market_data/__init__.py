"""Market data: one way in for prices.

    models.py      bars, quotes, trades and order books, as STRATA uses them
    calendars.py   which days a market trades (the exchange calendar for stocks)
    validation.py  checks that refuse bad data: gaps, duplicates, impossible prices
    cache.py       downloaded history kept on disk, checked by SHA-256 when read
    providers.py   the MarketDataProvider interface and its errors
    alpaca.py      the Alpaca provider (read-only market data, with paper keys)
    mock.py        a deterministic provider for tests and for working offline
    service.py     MarketData: fetch or reuse, validate, record, and only then use

Everything that needs prices (indicators, backtests, agents, paper trading)
gets them from MarketData, so every bar STRATA uses has been checked and can
be traced to where it came from (the market_data_metadata table).
"""
