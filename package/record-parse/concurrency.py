# 与 temp/src/graph/nodes/parser.py ConcurrencyCalculator 一致


class ConcurrencyCalculator:
    # api_min/api_max are soft targets; worker still caps by RECORD_PARSE_API_CONCURRENCY.
    STRATEGY_TABLE = [
        (0, 200, 16, 28, 32, 56),
        (200, 400, 28, 32, 56, 64),
        (400, 600, 32, 32, 64, 64),
        (600, 800, 32, 32, 64, 64),
        (800, 9999, 32, 32, 64, 64),
    ]

    @classmethod
    def calculate(cls, page_count: int):
        if page_count <= 0:
            return 1, 1
        for min_p, max_p, api_min, api_max, pool_min, pool_max in cls.STRATEGY_TABLE:
            if min_p <= page_count < max_p:
                ratio = (page_count - min_p) / (max_p - min_p) if max_p != 9999 else 1
                api_limit = int(api_min + (api_max - api_min) * ratio)
                pool_size = int(pool_min + (pool_max - pool_min) * ratio)
                return api_limit, pool_size
        return 32, 64


def effective_workers(pool_size: int, *api_limits: int) -> int:
    max_limit = max(api_limits) if api_limits else 1
    return max(1, min(pool_size, max_limit * 2))
