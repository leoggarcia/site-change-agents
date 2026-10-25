import os

# Tests never send traces, whatever keys the developer's .env has (load_dotenv doesn't override set variables).
os.environ["LANGFUSE_PUBLIC_KEY"] = ""
os.environ["LANGFUSE_SECRET_KEY"] = ""
