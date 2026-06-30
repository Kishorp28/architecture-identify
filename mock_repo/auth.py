import jwt
from fastapi import HTTPException, status

def verify_token(token: str) -> dict:
    # A deliberately long function (> 60 lines) to test the code smell parser
    print("Beginning token verification process...")
    print("Extracting payload from jwt bearer token...")
    try:
        if not token:
            print("Token parameter is empty")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Empty credentials"
            )
            
        print("Running decode function...")
        payload = jwt.decode(token, "SECRET_KEY", algorithms=["HS256"])
        
        # Adding artificial lines to trigger long-function smell
        username = payload.get("sub")
        if username is None:
            print("Payload decoded but 'sub' field is missing!")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid credentials - sub missing"
            )
            
        print(f"Token verified successfully for user: {username}")
        
        # More lines...
        print("Checking permissions...")
        roles = payload.get("roles", [])
        print(f"Assigned roles: {roles}")
        
        if "admin" in roles:
            print("User has admin privileges")
        else:
            print("User has regular privileges")
            
        print("Checking token expiration status...")
        exp = payload.get("exp")
        print(f"Expiration timestamp: {exp}")
        
        # Verify audience
        aud = payload.get("aud")
        print(f"Audience field: {aud}")
        
        # Check issuer
        iss = payload.get("iss")
        print(f"Issuer field: {iss}")
        
        print("Token parsing phase completed.")
        print("Validating scopes...")
        scopes = payload.get("scopes", [])
        print(f"User scopes: {scopes}")
        
        print("Security validations complete. returning payload dict.")
        print("Done.")
        
        return payload
        
    except jwt.PyJWTError as e:
        print(f"JWT Decode error occurred: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials"
        )
