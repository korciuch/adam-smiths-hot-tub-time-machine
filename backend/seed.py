"""Seeds a few sample companies/prices/notes for local frontend dev."""
from datetime import date, timedelta

from app.database import Base, SessionLocal, engine
from app.models import Company, Note, Price

Base.metadata.create_all(bind=engine)

SAMPLE_COMPANIES = [
    ("AAPL", "Apple Inc.", "Technology"),
    ("MSFT", "Microsoft Corporation", "Technology"),
    ("AMZN", "Amazon.com, Inc.", "Consumer Discretionary"),
]


def run():
    db = SessionLocal()
    try:
        if db.query(Company).first():
            print("Data already present, skipping seed.")
            return

        today = date.today()
        for ticker, name, sector in SAMPLE_COMPANIES:
            company = Company(ticker=ticker, name=name, sector=sector)
            db.add(company)
            db.flush()

            price = 100.0
            for i in range(30, 0, -1):
                price += (i % 5) - 2
                db.add(
                    Price(
                        company_id=company.id,
                        date=today - timedelta(days=i),
                        open=price - 1,
                        high=price + 2,
                        low=price - 2,
                        close=price,
                        volume=1_000_000 + i * 1000,
                    )
                )

        db.add(Note(company_id=1, date=today - timedelta(days=5), text="Sample note: minor dip, no news found."))
        db.commit()
        print("Seeded sample data.")
    finally:
        db.close()


if __name__ == "__main__":
    run()
