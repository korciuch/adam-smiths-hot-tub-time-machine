#!/usr/bin/env python3
"""
Simple test driver for validating the Finnhub WebSocket real-time trade feed.

Usage:
    export FINNHUB_API_KEY=your_key_here
    python finnhub_ws_test.py
    python finnhub_ws_test.py --symbols AAPL,MSFT,BINANCE:BTCUSDT --duration 20

Notes:
    - Finnhub's free tier only pushes a "trade" message when an actual trade
      prints for that symbol. US equities only trade during market hours, so
      if you run this outside 9:30-16:00 ET on a weekday you may see zero
      equity trades. Crypto symbols (e.g. BINANCE:BTCUSDT) trade 24/7 and are
      a reliable way to confirm the socket itself is working at any time.
    - Docs: https://finnhub.io/docs/api/websocket-trades
"""

import argparse
import json
import os
import sys
import threading
import time
from datetime import datetime, timezone

try:
    import websocket  # from the `websocket-client` package
except ImportError:
    sys.exit(
        "Missing dependency 'websocket-client'.\n"
        "Install it with: pip install -r requirements.txt"
    )

try:
    from dotenv import load_dotenv

    # Loads variables from a `.env` file in this directory (if present) into
    # the environment, without overriding any that are already set.
    load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))
except ImportError:
    # python-dotenv is optional: FINNHUB_API_KEY can still be set directly
    # in the environment or passed via --api-key.
    pass

FINNHUB_WS_URL = "wss://ws.finnhub.io"


class FinnhubWebSocketTester:
    def __init__(self, api_key: str, symbols: list[str], duration: float, verbose: bool = False):
        self.api_key = api_key
        self.symbols = symbols
        self.duration = duration
        self.verbose = verbose

        self.trade_count = 0
        self.messages_by_type: dict[str, int] = {}
        self.symbols_seen: set[str] = set()
        self.connected = False
        self.error: Exception | None = None

        self.ws: websocket.WebSocketApp | None = None
        self._close_timer: threading.Timer | None = None

    # --- WebSocketApp callbacks -------------------------------------------------

    def on_open(self, ws):
        self.connected = True
        print(f"[{self._ts()}] Connected to {FINNHUB_WS_URL}")
        for symbol in self.symbols:
            payload = json.dumps({"type": "subscribe", "symbol": symbol})
            ws.send(payload)
            print(f"[{self._ts()}] Subscribed to {symbol}")

        # Schedule a clean shutdown after `duration` seconds so this script
        # can be used as a non-interactive validation check (e.g. in CI).
        self._close_timer = threading.Timer(self.duration, self._timeout_close)
        self._close_timer.daemon = True
        self._close_timer.start()

    def on_message(self, ws, raw_message):
        try:
            message = json.loads(raw_message)
        except json.JSONDecodeError:
            print(f"[{self._ts()}] Received non-JSON message: {raw_message!r}")
            return

        msg_type = message.get("type", "unknown")
        self.messages_by_type[msg_type] = self.messages_by_type.get(msg_type, 0) + 1

        if msg_type == "trade":
            for trade in message.get("data", []):
                self.trade_count += 1
                symbol = trade.get("s")
                price = trade.get("p")
                volume = trade.get("v")
                trade_ts_ms = trade.get("t")
                self.symbols_seen.add(symbol)
                trade_time = (
                    datetime.fromtimestamp(trade_ts_ms / 1000, tz=timezone.utc).isoformat()
                    if trade_ts_ms
                    else "?"
                )
                print(
                    f"[{self._ts()}] TRADE  {symbol:<18} price={price!s:<12} "
                    f"volume={volume!s:<10} trade_time={trade_time}"
                )
        elif msg_type == "ping":
            if self.verbose:
                print(f"[{self._ts()}] ping")
        elif msg_type == "error":
            print(f"[{self._ts()}] ERROR from server: {message}")
        else:
            print(f"[{self._ts()}] {msg_type}: {message}")

    def on_error(self, ws, error):
        self.error = error
        print(f"[{self._ts()}] WebSocket error: {error}")

    def on_close(self, ws, close_status_code, close_msg):
        self.connected = False
        print(f"[{self._ts()}] Connection closed (code={close_status_code}, msg={close_msg})")

    # --- Helpers -----------------------------------------------------------------

    def _timeout_close(self):
        print(f"[{self._ts()}] Test duration ({self.duration}s) elapsed, closing connection...")
        if self.ws is not None:
            self.ws.close()

    @staticmethod
    def _ts() -> str:
        return datetime.now().strftime("%H:%M:%S")

    def run(self):
        url = f"{FINNHUB_WS_URL}?token={self.api_key}"
        self.ws = websocket.WebSocketApp(
            url,
            on_open=self.on_open,
            on_message=self.on_message,
            on_error=self.on_error,
            on_close=self.on_close,
        )
        self.ws.run_forever()

        if self._close_timer is not None:
            self._close_timer.cancel()

        self._print_summary()

    def _print_summary(self):
        print("\n--- Test Summary ---")
        print(f"Symbols requested:   {', '.join(self.symbols)}")
        print(f"Symbols with trades: {', '.join(sorted(self.symbols_seen)) or '(none)'}")
        print(f"Total trade prints:  {self.trade_count}")
        print(f"Message type counts: {self.messages_by_type or '(none received)'}")

        if self.error:
            print(f"Result: FAILED (error: {self.error})")
        elif self.trade_count > 0:
            print("Result: PASSED - received live trade data.")
        elif self.messages_by_type:
            print(
                "Result: CONNECTED but no trades received. This is expected if "
                "markets are closed for all requested symbols. Try a 24/7 symbol "
                "like BINANCE:BTCUSDT to confirm the feed is alive."
            )
        else:
            print("Result: FAILED - no messages received at all. Check your API key/network.")


def parse_args():
    parser = argparse.ArgumentParser(description="Validate the Finnhub WebSocket trade feed.")
    parser.add_argument(
        "--symbols",
        default="AAPL,MSFT,BINANCE:BTCUSDT",
        help="Comma-separated list of symbols to subscribe to "
        "(default: AAPL,MSFT,BINANCE:BTCUSDT). Include a crypto symbol to "
        "guarantee data even outside stock market hours.",
    )
    parser.add_argument(
        "--duration",
        type=float,
        default=20.0,
        help="Seconds to listen before closing the connection (default: 20).",
    )
    parser.add_argument(
        "--api-key",
        default=None,
        help="Finnhub API key. Defaults to the FINNHUB_API_KEY environment variable.",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Also print ping/keepalive messages.",
    )
    return parser.parse_args()


def main():
    args = parse_args()
    api_key = args.api_key or os.environ.get("FINNHUB_API_KEY")
    if not api_key:
        sys.exit(
            "No API key provided. Set FINNHUB_API_KEY in your environment or "
            "pass --api-key YOUR_KEY.\n"
            "Get a free key at https://finnhub.io/register"
        )

    symbols = [s.strip() for s in args.symbols.split(",") if s.strip()]
    if not symbols:
        sys.exit("No symbols provided.")

    tester = FinnhubWebSocketTester(
        api_key=api_key, symbols=symbols, duration=args.duration, verbose=args.verbose
    )

    try:
        tester.run()
    except KeyboardInterrupt:
        print("\nInterrupted by user, closing...")
        if tester.ws is not None:
            tester.ws.close()
        tester._print_summary()


if __name__ == "__main__":
    main()
