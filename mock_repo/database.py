from sqlalchemy import Column, Integer, String, Float
from sqlalchemy.ext.declarative import declarative_base

Base = declarative_base()

class User(Base):
    __tablename__ = "users"
    
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True)
    email = Column(String, unique=True, index=True)
    password = Column(String)

class Product(Base):
    __tablename__ = "products"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True)
    price = Column(Float)
    description = Column(String)

# Local mock DB helper
class MockDB:
    def __init__(self):
        self.users = {
            "john": User(id=1, username="john", email="john@example.com", password="password123")
        }
        self.products = [
            Product(id=1, name="Laptop", price=999.99, description="High performance developer laptop")
        ]
        
    def get_user(self, username: str) -> User:
        return self.users.get(username)
        
    def list_products(self):
        return [{"id": p.id, "name": p.name, "price": p.price} for p in self.products]

def get_db():
    return MockDB()
