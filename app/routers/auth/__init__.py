from fastapi import APIRouter

from .buyer import router as buyer_router
from .seller import router as seller_router
from .internal import router as internal_router
from .me import router as me_router

auth_router = APIRouter(prefix="/auth")

auth_router.include_router(buyer_router)
auth_router.include_router(seller_router)
auth_router.include_router(internal_router)
auth_router.include_router(me_router)
