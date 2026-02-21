import os
import pyodbc
from dotenv import load_dotenv
import logging

load_dotenv()

DB_SERVER = os.getenv("DB_SERVER", "localhost")
DB_NAME = os.getenv("DB_NAME", "SecurityMonitor")
DB_USER = os.getenv("DB_USER", "sa")
DB_PASSWORD = os.getenv("DB_PASSWORD", "YourSecurePassword")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def get_db_connection():
    try:
        conn_str = (
            f"DRIVER={{ODBC Driver 17 for SQL Server}};"
            f"SERVER={DB_SERVER};"
            f"DATABASE={DB_NAME};"
            f"Trusted_Connection=yes;"
            f"Encrypt=yes;"
            f"TrustServerCertificate=yes;"
        )
        conn = pyodbc.connect(conn_str)
        return conn
    except Exception as e:
        logger.error(f"Database connection error: {e}")
        raise e

def init_db():
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT 1 FROM sys.tables WHERE name='FailedLoginAttempts'")
        if cursor.fetchone():
            logger.info("Database schemas appear to exist. Skipping full init.")
            return

        with open('../DATABASE_SCHEMA.md', 'r') as f:
            content = f.read()

        # For a full reliable initialization, we should split the schema into proper
        # execute blocks. In this minimal skeleton, we just ensure the connection works.
        # It's recommended to run the SCHEMA manually via SSMS / sqlcmd per instructions.
        logger.info("Database connected. Please ensure DATABASE_SCHEMA.md is applied via SSMS.")
        
    except Exception as e:
        logger.error(f"Error during init_db: {e}")
    finally:
        cursor.close()
        conn.close()
