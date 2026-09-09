import csv
import io
import math

from ..models import Candle


class DataService:
    REQUIRED = {"time", "open", "high", "low", "close"}

    @staticmethod
    def _number(value, name):
        try:
            number = float(value)
        except (TypeError, ValueError) as exc:
            raise ValueError(f"{name} must be numeric") from exc
        if not math.isfinite(number):
            raise ValueError(f"{name} must be finite")
        return number

    def parse_csv(self, text: str):
        if not isinstance(text, str):
            raise ValueError("CSV content must be text")

        reader = csv.DictReader(io.StringIO(text))
        fieldnames = set(reader.fieldnames or [])
        missing = self.REQUIRED - fieldnames
        if missing:
            raise ValueError("Missing columns: " + ", ".join(sorted(missing)))

        candles = []
        for row_number, row in enumerate(reader, start=2):
            try:
                timestamp = self._number(row.get("time"), "time")
                if timestamp < 0 or timestamp != int(timestamp):
                    raise ValueError("time must be a non-negative integer")
                payload = {
                    "time": int(timestamp),
                    "open": self._number(row.get("open"), "open"),
                    "high": self._number(row.get("high"), "high"),
                    "low": self._number(row.get("low"), "low"),
                    "close": self._number(row.get("close"), "close"),
                    "volume": self._number(row.get("volume") or 0, "volume"),
                }
                candles.append(Candle.model_validate(payload).model_dump())
            except ValueError as exc:
                raise ValueError(f"invalid candle on CSV row {row_number}: {exc}") from exc

        return candles
