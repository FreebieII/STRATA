"""Who may use STRATA's API and dashboard.

    passwords.py   hashing and checking operator passwords (scrypt)
    operators.py   creating, disabling and checking operator accounts
    sessions.py    dashboard login sessions, kept in Redis
    limits.py      slowing down password guessing

Scripts and tools use the ADMIN_API_TOKEN from .env instead of an account.
"""
