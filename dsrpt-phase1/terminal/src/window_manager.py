"""
Dsrpt Terminal — Window Manager

Maintains a rolling price/volume buffer with strict temporal integrity.

Critical design constraint:
  At timestamp T, the window contains ONLY data where timestamp <= T.
  No future data ever enters the window. This is enforced at the insert level,
  not as a post-hoc filter — because post-hoc filtering is how hindsight bias
  silently enters replay systems.

Window parameters:
  - min_hours:  minimum hours of data before classifier fires (avoids noise on cold start)
  - max_hours:  maximum lookback window (older data dropped)
  - Default: 48h window, 4h minimum warmup
"""

import pandas as pd
import numpy as np
from collections import deque
from dataclasses import dataclass
from datetime import datetime, timezone, timedelta
from typing import Optional


@dataclass
class Tick:
    timestamp: datetime
    price:     float
    volume:    float
    source:    str = "live"


class WindowManager:
    def __init__(self, max_hours: float = 48.0, min_hours: float = 4.0):
        self.max_hours  = max_hours
        self.min_hours  = min_hours
        self._buffer    = deque()
        self._current_t = None

    def insert(self, tick: Tick):
        """
        Insert a tick. Enforces:
          1. Monotonic time — rejects ticks older than current head
          2. Window eviction — drops ticks outside max_hours lookback
        """
        if self._current_t and tick.timestamp <= self._current_t:
            return  # reject out-of-order or duplicate

        self._buffer.append(tick)
        self._current_t = tick.timestamp

        # Evict ticks outside the lookback window
        cutoff = tick.timestamp - timedelta(hours=self.max_hours)
        while self._buffer and self._buffer[0].timestamp < cutoff:
            self._buffer.popleft()

    def is_ready(self) -> bool:
        """True when window has enough data to run classifier."""
        if len(self._buffer) < 2:
            return False
        span = (self._buffer[-1].timestamp - self._buffer[0].timestamp).total_seconds() / 3600
        return span >= self.min_hours

    def to_dataframe(self) -> Optional[pd.DataFrame]:
        if not self.is_ready():
            return None
        rows = [{"timestamp": t.timestamp, "price": t.price, "volume": t.volume}
                for t in self._buffer]
        return pd.DataFrame(rows)

    @property
    def span_hours(self) -> float:
        if len(self._buffer) < 2:
            return 0.0
        return (self._buffer[-1].timestamp - self._buffer[0].timestamp).total_seconds() / 3600

    @property
    def current_price(self) -> Optional[float]:
        return self._buffer[-1].price if self._buffer else None

    @property
    def n_ticks(self) -> int:
        return len(self._buffer)
