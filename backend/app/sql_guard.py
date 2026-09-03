"""Validation for client-supplied SQL.

The browser generates this SQL with a local WebLLM model, so the string
arriving here is untrusted twice over: the model is unreliable, and the
endpoint is public - anything can POST to it directly, with or without a
model involved. The "only SELECT statements" rule in the client's system
prompt is a hint to a small language model, not an access control.

Three independent layers guard execution, so no single bypass is enough:

  1. Parse (this module) - reject anything that is not exactly one SELECT
     over the three known tables.
  2. Read-only connection (`readonly.py`) - the file is opened `mode=ro` and
     `PRAGMA query_only` is set, so writes fail even if this parser is fooled.
  3. Row cap and statement timeout (`readonly.py`) - bound the damage a
     perfectly valid but hostile SELECT can do.

Parsing is done with sqlglot rather than string matching. A regex for
"starts with SELECT" is trivially defeated (`SELECT 1; DROP TABLE prices`,
comment splicing, nested DML), and a regex denylist of keywords rejects
legitimate queries whose *column values* contain the word "delete".
"""

import sqlglot
from sqlglot import exp

# The schema advertised to the model. Anything else - `sqlite_master`, an
# ATTACHed file - is out of scope for a question about market data.
ALLOWED_TABLES = frozenset({"companies", "prices", "notes"})

# Root node types that constitute a read. `Select` covers plain and CTE-led
# queries; set operations cover UNION/EXCEPT/INTERSECT. Resolved defensively
# because sqlglot has renamed the set-operation base class across versions.
_QUERY_ROOTS = tuple(
    node
    for node in (getattr(exp, name, None) for name in ("Select", "SetOperation", "Union", "Subquery"))
    if isinstance(node, type)
)


class SqlNotAllowed(Exception):
    """The SQL is rejected before it ever reaches the database."""


def validate_select(sql: str) -> str:
    """Return `sql` unchanged if it is a single read-only SELECT.

    Raises `SqlNotAllowed` with a message written for the model: the client
    feeds it back for a correction pass, so it should say what to fix.
    """
    if not sql.strip():
        raise SqlNotAllowed("Empty query.")

    try:
        parsed = [statement for statement in sqlglot.parse(sql, read="sqlite") if statement]
    except sqlglot.ParseError as exc:
        raise SqlNotAllowed(f"Could not parse SQL: {exc}") from exc

    if not parsed:
        raise SqlNotAllowed("Empty query.")
    if len(parsed) > 1:
        raise SqlNotAllowed("Only one statement is allowed. Remove everything after the first SELECT.")

    statement = parsed[0]
    if not isinstance(statement, _QUERY_ROOTS):
        raise SqlNotAllowed("Only SELECT statements are allowed.")

    # sqlglot parses statements it has no grammar for (PRAGMA, ATTACH, VACUUM)
    # into a passthrough `Command` node. One anywhere in the tree means
    # something is present that this validator cannot reason about.
    if statement.find(exp.Command):
        raise SqlNotAllowed("Only SELECT statements are allowed.")

    # A CTE name is referenced as a table, so it has to be allowed alongside
    # the real ones - otherwise `WITH recent AS (...) SELECT * FROM recent`
    # would be rejected for reading a table called `recent`.
    cte_names = {cte.alias_or_name.lower() for cte in statement.find_all(exp.CTE)}

    for table in statement.find_all(exp.Table):
        name = table.name.lower()
        if name in cte_names or name in ALLOWED_TABLES:
            continue
        raise SqlNotAllowed(
            f"Unknown table {table.name!r}. Query only: {', '.join(sorted(ALLOWED_TABLES))}."
        )

    return sql
