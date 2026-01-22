import pyotp
import time

secret = 'KMB5SDYC56LZJB7F'
totp = pyotp.TOTP(secret)
target_code = '763950'

now = int(time.time())
# Check last 2 hours (in 30s steps)
for t in range(now - 7200, now + 7200, 30):
    if totp.at(t) == target_code:
        print(f"Match found at T={t} ({time.strftime('%Y-%m-%d %H:%M:%S', time.gmtime(t))} UTC)")
        print(f"Seconds from now: {t - now}")
