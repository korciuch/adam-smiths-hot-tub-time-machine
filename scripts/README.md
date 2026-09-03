# Finnhub WebSocket Test Driver

Validates the Finnhub real-time trade WebSocket.

## Setup

```bash
cd scripts
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # then add your key from https://finnhub.io/register
```

## Run

```bash
python finnhub_ws_test.py
```

Defaults to `AAPL,MSFT,BINANCE:BTCUSDT` for 20s (crypto guarantees data outside market hours).

Options: `--symbols`, `--duration`, `--api-key`, `--verbose`.
