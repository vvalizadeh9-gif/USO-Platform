"""Scheduled commands, run by cron or a Kubernetes CronJob -- never by the API.

Each module here is ``python -m app.jobs.<name>``. A scheduler inside the API
process would run once per worker; these run exactly where they are invoked.
"""
