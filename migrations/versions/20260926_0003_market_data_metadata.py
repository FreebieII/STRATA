"""A record of every download of market data.

Revision ID: 0003
Revises: 0002
Create Date: 2026-09-26

Each row says what was fetched (provider, symbol, timeframe, feed, price
adjustment, range), how many bars came back, whether the checks passed, and,
for data that passed, the cached file and its SHA-256 (see
strata/market_data/). Refused downloads are recorded too, and are never cached.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "market_data_metadata",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=True), nullable=False),
        sa.Column(
            "fetched_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("provider", sa.String(length=32), nullable=False),
        sa.Column("symbol", sa.String(length=32), nullable=False),
        sa.Column("asset_class", sa.String(length=16), nullable=False),
        sa.Column("timeframe", sa.String(length=16), nullable=False),
        sa.Column("feed", sa.String(length=16), nullable=False),
        sa.Column("adjustment", sa.String(length=16), nullable=False),
        sa.Column("range_start", sa.Date(), nullable=False),
        sa.Column("range_end", sa.Date(), nullable=False),
        sa.Column("bar_count", sa.Integer(), nullable=False),
        sa.Column("first_bar_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_bar_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("valid", sa.Boolean(), nullable=False),
        sa.Column(
            "issues",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
        sa.Column("file_name", sa.String(length=255), nullable=True),
        sa.Column("sha256", sa.String(length=64), nullable=True),
        sa.CheckConstraint(
            "asset_class IN ('stock', 'crypto')",
            name=op.f("ck_market_data_metadata_asset_class_known"),
        ),
        sa.CheckConstraint(
            "range_start <= range_end", name=op.f("ck_market_data_metadata_range_in_order")
        ),
        sa.CheckConstraint(
            "bar_count >= 0", name=op.f("ck_market_data_metadata_bar_count_not_negative")
        ),
        sa.CheckConstraint(
            "sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$'",
            name=op.f("ck_market_data_metadata_sha256_hex"),
        ),
        sa.CheckConstraint(
            "valid OR file_name IS NULL",
            name=op.f("ck_market_data_metadata_refused_data_not_cached"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_market_data_metadata")),
    )
    op.create_index(
        op.f("ix_market_data_metadata_fetched_at"),
        "market_data_metadata",
        ["fetched_at"],
        unique=False,
    )
    op.create_index(
        "ix_market_data_metadata_series",
        "market_data_metadata",
        ["symbol", "timeframe", "range_start", "range_end"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_market_data_metadata_series", table_name="market_data_metadata")
    op.drop_index(op.f("ix_market_data_metadata_fetched_at"), table_name="market_data_metadata")
    op.drop_table("market_data_metadata")
