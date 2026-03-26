from .admin import admin_router
from .auth import auth_router
from .auctions import auctions_router
from .deals import deals_router
from .documents import documents_router
from .exchange_rates import exchange_rates_router
from .kyc import kyc_router
from .marketplace import marketplace_router
from .notifications import notifications_router
from .payments import payments_router
from .purchase_requests import purchase_requests_router
from .reports import reports_router
from .seller import seller_router

__all__ = [
    "admin_router",
    "auth_router",
    "auctions_router",
    "deals_router",
    "documents_router",
    "exchange_rates_router",
    "kyc_router",
    "marketplace_router",
    "notifications_router",
    "payments_router",
    "purchase_requests_router",
    "reports_router",
    "seller_router",
]
