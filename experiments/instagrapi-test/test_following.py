"""
Test script for pulling a target account's following/followers list via instagrapi.

Usage:
    ./venv/bin/python test_following.py <your_ig_username> <target_username> [--followers]

Password is prompted interactively (getpass) - never passed as a CLI arg or
hardcoded, so it never lands in shell history or this file.

Session is cached to session.json (gitignored) so re-runs after the first
successful login don't need the password again.
"""
import sys
import json
import getpass
from pathlib import Path

from instagrapi import Client
from instagrapi.exceptions import TwoFactorRequired, ChallengeRequired

SESSION_DIR = Path(__file__).parent / "sessions"
SESSION_DIR.mkdir(exist_ok=True)


def login(username: str) -> Client:
    cl = Client()
    session_file = SESSION_DIR / f"{username}.json"

    if session_file.exists():
        cl.load_settings(session_file)
        try:
            cl.get_timeline_feed()  # cheap call to validate the session still works
            print(f"[+] Reused existing session for {username}")
            return cl
        except Exception:
            print("[!] Cached session invalid, logging in fresh")

    password = getpass.getpass(f"Instagram password for {username}: ")

    try:
        cl.login(username, password)
    except TwoFactorRequired:
        code = input("Enter the 2FA code sent to your device: ").strip()
        cl.login(username, password, verification_code=code)
    except ChallengeRequired:
        print("[!] Challenge required. Instagrapi will prompt for the code Instagram sends.")
        cl.challenge_code_handler = lambda u, ch: input(f"Enter the code Instagram sent for {u}: ").strip()
        cl.login(username, password)

    cl.dump_settings(session_file)
    print(f"[+] Logged in and saved session for {username}")
    return cl


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)

    login_username = sys.argv[1]
    target_username = sys.argv[2]
    want_followers = "--followers" in sys.argv[3:]

    cl = login(login_username)

    target_id = cl.user_id_from_username(target_username)
    print(f"[+] Resolved {target_username} -> user_id {target_id}")

    if want_followers:
        print(f"[+] Fetching followers of {target_username} ...")
        result = cl.user_followers(target_id)
    else:
        print(f"[+] Fetching who {target_username} is following ...")
        result = cl.user_following(target_id)

    users = [
        {"pk": pk, "username": u.username, "full_name": u.full_name, "is_private": u.is_private}
        for pk, u in result.items()
    ]

    out_file = Path(f"{target_username}_{'followers' if want_followers else 'following'}.json")
    out_file.write_text(json.dumps(users, indent=2, ensure_ascii=False))
    print(f"[+] Got {len(users)} accounts. Saved to {out_file}")


if __name__ == "__main__":
    main()
