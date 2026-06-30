from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
import jwt
from mock_repo.auth import verify_token
from mock_repo.database import get_db, User

app = FastAPI(title="Mock Store API")

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")

@app.post("/token")
def login(username: str, password: str, db=Depends(get_db)):
    user = db.get_user(username)
    if not user or user.password != password:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password"
        )
    # JWT Generation
    token = jwt.encode({"sub": user.username}, "SECRET_KEY", algorithm="HS256")
    return {"access_token": token, "token_type": "bearer"}

@app.get("/users/me")
def read_users_me(token: str = Depends(oauth2_scheme), db=Depends(get_db)):
    payload = verify_token(token)
    username = payload.get("sub")
    user = db.get_user(username)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    return {"username": user.username, "email": user.email}

@app.get("/api/products")
def get_products(db=Depends(get_db)):
    return db.list_products()
