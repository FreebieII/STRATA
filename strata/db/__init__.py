"""PostgreSQL: the permanent record of everything STRATA decides and does.

    base.py        the shared SQLAlchemy base class and constraint naming
    models.py      the tables
    session.py     connecting: database address, connection pool, time limits
    records.py     writing system events and audit entries (secrets hidden)
    migrations.py  applying the Alembic migrations in /migrations

Each development phase adds the tables it needs in its own migration.
"""
