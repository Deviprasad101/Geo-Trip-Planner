import os
import io
import json
import re
import csv
import socket
import secrets
import requests
import random
import uuid
import sys
from threading import Lock
from urllib.parse import quote, urlparse
from datetime import datetime, timedelta, timezone, date
from sqlalchemy import inspect, text
from sqlalchemy.exc import ProgrammingError
from flask import Flask, request, jsonify, send_from_directory, send_file, redirect, session, abort
from flask_cors import CORS
from flask_mail import Mail, Message
from flask_sqlalchemy import SQLAlchemy
from werkzeug.security import generate_password_hash, check_password_hash
from google import genai
from dotenv import load_dotenv
try:
    from twilio.rest import Client as TwilioClient
except ImportError:
    TwilioClient = None

load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env'))

import logging

# Project layout: backend/ | frontend/ | data/ | assets/
BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)
PROJECT_ROOT = os.path.dirname(BACKEND_DIR)
FRONTEND_DIR = os.path.join(PROJECT_ROOT, 'frontend')
DATA_DIR = os.path.join(PROJECT_ROOT, 'data')
ASSETS_DIR = os.path.join(PROJECT_ROOT, 'assets')
IMAGES_DIR = os.path.join(ASSETS_DIR, 'images')
FRONTEND_JS = frozenset({'chatbot.js', 'recommender.js', 'weather.js', 'features.js'})
FRONTEND_HTML = frozenset({
    'login.html', 'main_page.html', 'packages.html', 'booking.html', 'about.html',
})

_STATIC_RE = re.compile(
    r'\.(?:js|css|png|jpg|jpeg|avif|webp|gif|svg|ico|mp4|mp3|csv|woff2?|ttf|eot|map)\b',
    re.IGNORECASE,
)

class _QuietStatic(logging.Filter):
    def filter(self, record):
        msg = record.getMessage()
        if '/api/' in msg:
            return True
        if _STATIC_RE.search(msg):
            return False
        if '" 304 ' in msg or '" 206 ' in msg:
            return False
        return True

_wz = logging.getLogger('werkzeug')
_wz.addFilter(_QuietStatic())

app = Flask(__name__)
app.config['SEND_FILE_MAX_AGE_DEFAULT'] = 0
app.secret_key = os.getenv("SECRET_KEY", "dev_secret_key")
CORS(app)

def _env_on(name: str, default: str = '0') -> bool:
    return (os.getenv(name, default) or default).strip().lower() in ('1', 'true', 'yes', 'on')

# Set GEOTRIP_ENABLE_AI=1 or GEOTRIP_ENABLE_QR=1 in .env to re-enable
GEOTRIP_ENABLE_AI = _env_on('GEOTRIP_ENABLE_AI')
GEOTRIP_ENABLE_QR = _env_on('GEOTRIP_ENABLE_QR')


def _feature_disabled(feature_label: str):
    return jsonify({'status': 'error', 'message': f'{feature_label} is disabled on this server.'}), 503


def _require_ai():
    if not GEOTRIP_ENABLE_AI:
        return _feature_disabled('AI features (Gemini/Ollama/agent/chatbot)')
    return None


def _require_qr():
    if not GEOTRIP_ENABLE_QR:
        return _feature_disabled('QR code and temple check-in')
    return None

# Database Configuration (PostgreSQL with SQLAlchemy)
database_url = f"postgresql://{os.getenv('DB_USER')}:{os.getenv('DB_PASS')}@{os.getenv('DB_HOST')}:{os.getenv('DB_PORT')}/{os.getenv('DB_NAME')}"
app.config['SQLALCHEMY_DATABASE_URI'] = database_url
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

# Mail Configuration
app.config['MAIL_SERVER'] = (os.getenv('MAIL_SERVER') or 'smtp.gmail.com').strip()
app.config['MAIL_PORT'] = int(os.getenv('MAIL_PORT', 587))
app.config['MAIL_USE_TLS'] = os.getenv('MAIL_USE_TLS', 'True').lower() in ('1', 'true', 'yes')
app.config['MAIL_USE_SSL'] = os.getenv('MAIL_USE_SSL', 'False').lower() in ('1', 'true', 'yes')
app.config['MAIL_USERNAME'] = (os.getenv('MAIL_USERNAME') or '').strip()
# Gmail App Passwords are often pasted with spaces — remove them for SMTP
app.config['MAIL_PASSWORD'] = (os.getenv('MAIL_PASSWORD') or '').replace(' ', '')
app.config['MAIL_DEFAULT_SENDER'] = app.config['MAIL_USERNAME']

db = SQLAlchemy(app)
mail = Mail(app)


def _email_otp_fallback_enabled():
    return os.getenv('EMAIL_OTP_CONSOLE_FALLBACK', 'true').lower() in ('1', 'true', 'yes')


def _smtp_login_error_message():
    return (
        'Email server login failed. In .env set MAIL_USERNAME and a valid App Password '
        '(Google Account → Security → 2-Step Verification → App passwords). '
        'Regenerate the password if it was revoked.'
    )


def _send_via_smtp(recipients, subject, body):
    """Send email with smtplib; retry port 465 SSL if STARTTLS on 587 fails."""
    import smtplib
    import ssl

    username = app.config['MAIL_USERNAME']
    password = app.config['MAIL_PASSWORD']
    sender = app.config['MAIL_DEFAULT_SENDER'] or username
    if not username or not password:
        raise ValueError('MAIL_USERNAME and MAIL_PASSWORD must be set in .env')

    message = (
        f'From: {sender}\r\n'
        f'To: {", ".join(recipients)}\r\n'
        f'Subject: {subject}\r\n'
        f'Content-Type: text/plain; charset=utf-8\r\n'
        f'\r\n'
        f'{body}'
    )
    context = ssl.create_default_context()
    host = app.config['MAIL_SERVER']
    attempts = []
    if app.config['MAIL_USE_SSL']:
        attempts.append(('ssl', host, app.config['MAIL_PORT']))
    else:
        attempts.append(('starttls', host, app.config['MAIL_PORT']))
        if app.config['MAIL_PORT'] != 465:
            attempts.append(('ssl', host, 465))

    last_error = None
    for mode, smtp_host, smtp_port in attempts:
        try:
            if mode == 'ssl':
                with smtplib.SMTP_SSL(smtp_host, smtp_port, timeout=20, context=context) as smtp:
                    smtp.login(username, password)
                    smtp.sendmail(sender, recipients, message.encode('utf-8'))
            else:
                with smtplib.SMTP(smtp_host, smtp_port, timeout=20) as smtp:
                    smtp.ehlo()
                    if app.config['MAIL_USE_TLS']:
                        smtp.starttls(context=context)
                        smtp.ehlo()
                    smtp.login(username, password)
                    smtp.sendmail(sender, recipients, message.encode('utf-8'))
            return
        except Exception as exc:
            last_error = exc
    raise last_error


def _otp_response_extra(send_err, otp):
    """Return OTP to the UI only when email could not be sent (dev fallback)."""
    if send_err == 'otp_console_fallback' and otp and _email_otp_fallback_enabled():
        return {'dev_otp': otp, 'email_sent': False}
    return {'email_sent': send_err != 'otp_console_fallback'}


def _build_otp_email(greeting_name, purpose_line, otp):
    """Plain + HTML body so OTP is visible in all mail clients."""
    plain = (
        f"Hello {greeting_name},\n\n"
        f"{purpose_line}\n\n"
        f"Your verification code is: {otp}\n\n"
        f"This code expires in 5 minutes.\n"
        f"If you did not request this, you can ignore this email."
    )
    html = f"""<!DOCTYPE html>
<html><body style="font-family:Arial,sans-serif;color:#1e293b;line-height:1.5;">
<p>Hello {greeting_name},</p>
<p>{purpose_line}</p>
<p style="margin:24px 0;font-size:15px;">Your verification code is:</p>
<p style="margin:0 0 24px;font-size:32px;font-weight:bold;letter-spacing:8px;color:#7c3aed;">{otp}</p>
<p style="font-size:13px;color:#64748b;">This code expires in 5 minutes. If you did not request this, ignore this email.</p>
</body></html>"""
    return plain, html


def _send_email_message(msg, otp_hint=None):
    """Send email via Flask-Mail; on SMTP failure optionally allow dev OTP fallback."""
    try:
        mail.send(msg)
        return True, None
    except Exception as e:
        print(f'[ERROR] Email send failed: {e}')
        if otp_hint and _email_otp_fallback_enabled():
            recipients = ', '.join(msg.recipients or [])
            print(f'[DEV] Email OTP for {recipients}: {otp_hint}')
            return True, 'otp_console_fallback'
        err_text = str(e)
        if '535' in err_text or 'BadCredentials' in err_text or 'Username and Password' in err_text or 'Authentication Failed' in err_text:
            return False, _smtp_login_error_message()
        return False, 'Could not send email. Please try again later.'


def _check_mail_config():
    if not app.config['MAIL_USERNAME'] or not app.config['MAIL_PASSWORD']:
        print('[WARN] MAIL_USERNAME or MAIL_PASSWORD missing in .env — email OTP will use dev fallback only.')
        return
    import smtplib
    import ssl

    username = app.config['MAIL_USERNAME']
    password = app.config['MAIL_PASSWORD']
    host = app.config['MAIL_SERVER']
    context = ssl.create_default_context()
    attempts = []
    if app.config['MAIL_USE_SSL']:
        attempts.append(('ssl', app.config['MAIL_PORT']))
    else:
        attempts.append(('starttls', app.config['MAIL_PORT']))
        if app.config['MAIL_PORT'] != 465:
            attempts.append(('ssl', 465))
    last_error = None
    for mode, smtp_port in attempts:
        try:
            if mode == 'ssl':
                with smtplib.SMTP_SSL(host, smtp_port, timeout=15, context=context) as smtp:
                    smtp.login(username, password)
            else:
                with smtplib.SMTP(host, smtp_port, timeout=15) as smtp:
                    smtp.ehlo()
                    if app.config['MAIL_USE_TLS']:
                        smtp.starttls(context=context)
                        smtp.ehlo()
                    smtp.login(username, password)
            print(f"[OK] SMTP verified for {username}")
            return
        except Exception as exc:
            last_error = exc
    print(f'[WARN] SMTP login failed for {username}: {last_error}')
    if _email_otp_fallback_enabled():
        print('[WARN] OTP will show on screen until you fix Gmail App Password in .env')
    print('[WARN] Regenerate App Password: https://myaccount.google.com/apppasswords')

# User Model
class User(db.Model):
    __tablename__ = 'users'
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(100), nullable=False)
    email = db.Column(db.String(100), unique=True, nullable=False)
    phone = db.Column(db.String(20), nullable=True)
    password_hash = db.Column(db.String(255), nullable=False)
    qr_token = db.Column(db.String(32), unique=True, nullable=True, index=True)
    is_verified = db.Column(db.Boolean, default=False)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))

    def __init__(self, username, email, password_hash, phone=None, is_verified=False, qr_token=None):
        self.username = username
        self.email = email
        self.password_hash = password_hash
        self.phone = phone
        self.is_verified = is_verified
        self.qr_token = qr_token


class Temple(db.Model):
    __tablename__ = 'temples'
    id = db.Column(db.Integer, primary_key=True)
    csv_name = db.Column(db.String(200), unique=True, nullable=True, index=True)
    temple_name = db.Column(db.String(120), nullable=False)
    full_name = db.Column(db.String(200), nullable=False)
    location = db.Column(db.String(200), nullable=True)
    lat = db.Column(db.Float, nullable=True)
    lng = db.Column(db.Float, nullable=True)


class TempleVisit(db.Model):
    __tablename__ = 'temple_visits'
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False, index=True)
    temple_id = db.Column(db.Integer, db.ForeignKey('temples.id'), nullable=False, index=True)
    visit_date = db.Column(db.Date, nullable=False, index=True)
    visitor_number = db.Column(db.Integer, default=1, nullable=False, server_default='1')
    visit_count = db.Column(db.Integer, default=1, nullable=False)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now())
    updated_at = db.Column(
        db.DateTime,
        default=lambda: datetime.now(),
        onupdate=lambda: datetime.now(),
    )

    __table_args__ = (
        db.UniqueConstraint(
            'user_id', 'temple_id', 'visit_date', 'visitor_number',
            name='uq_user_temple_day_visitor',
        ),
    )

    user = db.relationship('User', backref=db.backref('temple_visits', lazy=True))
    temple = db.relationship('Temple', backref=db.backref('visits', lazy=True))


class Admin(db.Model):
    __tablename__ = 'admins'
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(100), unique=True, nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))


TIRUPATI_CSV_PATH = os.path.join(DATA_DIR, 'tirupati_main_data.csv')
TEMPLE_VISIT_COOLDOWN_MINUTES = max(1, int(os.getenv('TEMPLE_VISIT_COOLDOWN_MINUTES', '10')))


QR_TOKEN_PATTERN = re.compile(r'^(GTP-USER-[A-Z0-9]{8}|GTX-[A-Z0-9]{5})$', re.IGNORECASE)


def generate_qr_token():
    """Secure personal QR token, e.g. GTP-USER-8F3K9X2P"""
    while True:
        token = f"GTP-USER-{secrets.token_hex(4).upper()}"
        if not User.query.filter_by(qr_token=token).first():
            return token


def is_valid_qr_token(token):
    if not token:
        return False
    return bool(QR_TOKEN_PATTERN.match(str(token).strip().upper()))


def ensure_qr_token(user):
    """Assign token once per user; never regenerate if already set."""
    if not user:
        return None
    existing = (user.qr_token or '').strip().upper()
    if existing and is_valid_qr_token(existing):
        if user.qr_token != existing:
            user.qr_token = existing
            db.session.commit()
        return existing
    token = generate_qr_token()
    user.qr_token = token
    db.session.commit()
    return token


def resolve_user(identifier):
    """Resolve visitor by secure QR token only (not numeric user id)."""
    if not identifier:
        return None
    ident = str(identifier).strip().upper()
    if ident.isdigit():
        return None
    if not is_valid_qr_token(ident):
        return None
    return User.query.filter_by(qr_token=ident).first()


def normalize_phone(raw):
    """Normalize Indian mobile number to E.164 format (+91XXXXXXXXXX)."""
    if not raw:
        return None
    digits = re.sub(r'\D', '', raw)
    if digits.startswith('91') and len(digits) == 12:
        digits = digits[2:]
    if len(digits) != 10 or digits[0] not in '6789':
        return None
    return '+91' + digits


def _send_twilio_verify(phone_e164):
    """Send OTP via Twilio Verify; returns (ok, error_message)."""
    if not twilio_client or not TWILIO_VERIFY_SID:
        print(f'[WARN] Twilio not configured. Skipping phone OTP for {phone_e164}.')
        return False, 'SMS service not configured. Contact admin.'
    try:
        twilio_client.verify.v2.services(TWILIO_VERIFY_SID) \
            .verifications.create(to=phone_e164, channel='sms')
        print(f'[DEBUG] Phone OTP sent via Twilio to {phone_e164}')
        return True, None
    except Exception as e:
        print(f'[ERROR] Twilio send failed: {e}')
        return False, str(e)


def _check_twilio_verify(phone_e164, code):
    """Check OTP via Twilio Verify; returns (approved, error_message)."""
    if not twilio_client or not TWILIO_VERIFY_SID:
        return False, 'SMS service not configured.'
    try:
        check = twilio_client.verify.v2.services(TWILIO_VERIFY_SID) \
            .verification_checks.create(to=phone_e164, code=code)
        if check.status == 'approved':
            return True, None
        return False, 'Invalid OTP code'
    except Exception as e:
        print(f'[ERROR] Twilio verify failed: {e}')
        return False, 'Verification failed. Try again.'


def _parse_visitor_number(data):
    """Visitor slot on a QR batch (1 = QR holder, 2+ = companions). Same login email for all."""
    raw = data.get('visitorNumber')
    if raw is None:
        raw = data.get('guestNumber')
    if raw is None or str(raw).strip() in ('', 'null', 'None'):
        return 1
    try:
        n = int(raw)
    except (TypeError, ValueError):
        return 1
    return max(1, n)


def _record_visit_for_user(user, temple_id, visitor_number=1):
    temple = db.session.get(Temple, int(temple_id))
    if not temple:
        return None, {'message': 'Temple not found.'}, 404

    visitor_number = max(1, int(visitor_number or 1))
    today = date.today()
    now = _visit_now()
    cooldown_sec = _cooldown_seconds()
    cooldown_min = cooldown_sec // 60

    visit = TempleVisit.query.filter_by(
        user_id=user.id,
        temple_id=temple.id,
        visit_date=today,
        visitor_number=visitor_number,
    ).first()

    if visit:
        # Same temple today already checked in — enforce 10 min gap (only updated_at)
        if (visit.visit_count or 0) >= 1 and visit.updated_at:
            last_touch = _visit_dt_from_db(visit.updated_at)
            if last_touch:
                elapsed_sec = (now - last_touch).total_seconds()
                # Negative = clock skew / TZ mismatch → do not block with huge wait
                if 0 <= elapsed_sec < cooldown_sec:
                    wait_sec = int(cooldown_sec - elapsed_sec)
                    wait_sec = max(1, min(wait_sec, cooldown_sec))
                    return None, {
                        'message': _cooldown_message(wait_sec),
                        'cooldown': True,
                        'retryAfterSeconds': wait_sec,
                        'cooldownMinutes': cooldown_min,
                    }, 429
        visit.visit_count = (visit.visit_count or 0) + 1
        visit.updated_at = now
        count = visit.visit_count
        is_first = False
    else:
        visit = TempleVisit(
            user_id=user.id,
            temple_id=temple.id,
            visit_date=today,
            visitor_number=visitor_number,
            visit_count=1,
            created_at=now,
            updated_at=now,
        )
        db.session.add(visit)
        count = 1
        is_first = True

    db.session.commit()
    return {
        'status': 'ok',
        'isFirstVisitToday': is_first,
        'visitCount': count,
        'message': visit_message(count),
        'cooldownMinutes': cooldown_min,
        'temple': {
            'id': temple.id,
            'templeName': temple.temple_name,
            'fullName': temple.full_name,
            'location': temple.location or '',
        },
        'user': {'id': user.id, 'name': user.username, 'email': user.email},
        'visitorNumber': visitor_number,
        'visitorLabel': f'Visitor {visitor_number}',
        'visitDate': today.isoformat(),
    }, None, 200


def user_public_dict(user, client_origin=None):
    token = ensure_qr_token(user)
    base = get_share_base_url(client_origin)
    return {
        'id': user.id,
        'name': user.username,
        'email': user.email,
        'phone': user.phone or '',
        'qrToken': token,
        'qrUrl': f'{base}/user/{token}',
    }


def visit_message(count):
    if count <= 1:
        return 'Welcome! This is your first visit today.'
    suffix = 'th'
    if count % 10 == 1 and count % 100 != 11:
        suffix = 'st'
    elif count % 10 == 2 and count % 100 != 12:
        suffix = 'nd'
    elif count % 10 == 3 and count % 100 != 13:
        suffix = 'rd'
    return f'This is your {count}{suffix} visit today.'


def _visit_now():
    """Local naive time — matches PostgreSQL timestamp without time zone."""
    return datetime.now()


def _visit_dt_from_db(dt):
    if not dt:
        return None
    if dt.tzinfo is not None:
        return dt.astimezone().replace(tzinfo=None)
    return dt


def _cooldown_seconds():
    return max(60, int(os.getenv('TEMPLE_VISIT_COOLDOWN_MINUTES', '10')) * 60)


def _cooldown_message(wait_seconds):
    wait_seconds = max(1, int(wait_seconds))
    minutes, seconds = divmod(wait_seconds, 60)
    if minutes and seconds:
        return (
            f'Please wait {minutes} min {seconds} sec before checking in again at this temple.'
        )
    if minutes:
        return f'Please wait {minutes} minute(s) before checking in again at this temple.'
    return f'Please wait {seconds} second(s) before checking in again at this temple.'


def _ensure_user_columns():
    try:
        cols = {c['name'] for c in inspect(db.engine).get_columns('users')}
    except Exception:
        return
    stmts = []
    if 'phone' not in cols:
        stmts.append('ALTER TABLE users ADD COLUMN phone VARCHAR(20)')
    if 'qr_token' not in cols:
        stmts.append('ALTER TABLE users ADD COLUMN qr_token VARCHAR(32)')
    for sql in stmts:
        try:
            db.session.execute(text(sql))
            db.session.commit()
        except ProgrammingError:
            db.session.rollback()


def _ensure_visit_columns():
    try:
        cols = {c['name'] for c in inspect(db.engine).get_columns('temple_visits')}
    except Exception:
        return
    if 'visitor_number' not in cols:
        try:
            db.session.execute(text(
                'ALTER TABLE temple_visits ADD COLUMN visitor_number INTEGER NOT NULL DEFAULT 1'
            ))
            db.session.commit()
        except ProgrammingError:
            db.session.rollback()
    try:
        db.session.execute(text(
            'ALTER TABLE temple_visits DROP CONSTRAINT IF EXISTS uq_user_temple_day'
        ))
        db.session.commit()
    except ProgrammingError:
        db.session.rollback()
    try:
        db.session.execute(text(
            'ALTER TABLE temple_visits ADD CONSTRAINT uq_user_temple_day_visitor '
            'UNIQUE (user_id, temple_id, visit_date, visitor_number)'
        ))
        db.session.commit()
    except ProgrammingError:
        db.session.rollback()


def _ensure_temple_columns():
    try:
        cols = {c['name'] for c in inspect(db.engine).get_columns('temples')}
    except Exception:
        return
    stmts = []
    if 'csv_name' not in cols:
        stmts.append('ALTER TABLE temples ADD COLUMN csv_name VARCHAR(200)')
    if 'lat' not in cols:
        stmts.append('ALTER TABLE temples ADD COLUMN lat DOUBLE PRECISION')
    if 'lng' not in cols:
        stmts.append('ALTER TABLE temples ADD COLUMN lng DOUBLE PRECISION')
    for sql in stmts:
        try:
            db.session.execute(text(sql))
            db.session.commit()
        except ProgrammingError:
            db.session.rollback()
    try:
        db.session.execute(text(
            'CREATE UNIQUE INDEX IF NOT EXISTS ix_temples_csv_name ON temples (csv_name) '
            'WHERE csv_name IS NOT NULL'
        ))
        db.session.commit()
    except Exception:
        db.session.rollback()


def _sync_temples_from_csv():
    """Load all Temple-category rows from tirupati_main_data.csv into PostgreSQL."""
    if not os.path.isfile(TIRUPATI_CSV_PATH):
        print('[WARN] tirupati_main_data.csv not found; temple list not synced.')
        return

    seen_names = set()
    with open(TIRUPATI_CSV_PATH, encoding='utf-8', newline='') as fh:
        for row in csv.DictReader(fh):
            if (row.get('category') or '').strip().lower() != 'temple':
                continue
            name = (row.get('name') or '').strip()
            if not name:
                continue
            seen_names.add(name)
            lat = lng = None
            try:
                if row.get('lat'):
                    lat = float(row['lat'])
                if row.get('lng'):
                    lng = float(row['lng'])
            except (TypeError, ValueError):
                pass
            location = 'Tirupati region'
            if lat is not None and lng is not None:
                location = f'Tirupati ({lat:.4f}, {lng:.4f})'

            existing = Temple.query.filter_by(csv_name=name).first()
            if existing:
                existing.temple_name = name[:120]
                existing.full_name = name[:200]
                existing.location = location
                existing.lat = lat
                existing.lng = lng
            else:
                db.session.add(Temple(
                    csv_name=name,
                    temple_name=name[:120],
                    full_name=name[:200],
                    location=location,
                    lat=lat,
                    lng=lng,
                ))

    db.session.commit()
    print(f'[INFO] Synced {len(seen_names)} temples from tirupati_main_data.csv')


def _backfill_qr_tokens():
    for user in User.query.filter((User.qr_token == None) | (User.qr_token == '')).all():  # noqa: E711
        ensure_qr_token(user)
    for user in User.query.all():
        if user.qr_token and not is_valid_qr_token(user.qr_token):
            user.qr_token = None
            db.session.commit()
            ensure_qr_token(user)


def _sync_admin_credentials():
    """Ensure admin exists and password matches ADMIN_USERNAME / ADMIN_PASSWORD in .env."""
    uname = (os.getenv('ADMIN_USERNAME') or 'admin').strip()
    pwd = (os.getenv('ADMIN_PASSWORD') or 'admin').strip()
    if not uname:
        return

    admin = Admin.query.filter(
        db.func.lower(Admin.username) == uname.lower()
    ).first()
    if admin:
        admin.username = uname
        if not check_password_hash(admin.password_hash, pwd):
            admin.password_hash = generate_password_hash(pwd)
            db.session.commit()
            print(f'[INFO] Admin "{uname}" password synced from .env')
        else:
            db.session.commit()
        return

    admin = Admin(
        username=uname,
        password_hash=generate_password_hash(pwd),
    )
    db.session.add(admin)
    db.session.commit()
    print(f'[INFO] Admin "{uname}" created from .env')


def init_db():
    db.create_all()
    _ensure_user_columns()
    _ensure_visit_columns()
    _ensure_temple_columns()
    _sync_temples_from_csv()
    _backfill_qr_tokens()
    _sync_admin_credentials()


with app.app_context():
    init_db()

# Disable caching for development
@app.after_request
def add_header(response):
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    response.headers['Cache-Control'] = 'public, max-age=0'
    return response

# Configure Gemini
api_key = os.getenv("GEMINI_API_KEY")
WEATHER_API_KEY = os.getenv("WEATHER_API_KEY")
client = genai.Client(api_key=api_key) if api_key else None

_WMO_LABELS = {
    0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
    45: 'Foggy', 48: 'Foggy',
    51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle',
    61: 'Light rain', 63: 'Rain', 65: 'Heavy rain',
    71: 'Light snow', 73: 'Snow', 75: 'Heavy snow',
    80: 'Light showers', 81: 'Showers', 82: 'Heavy showers',
    95: 'Thunderstorm', 96: 'Thunderstorm with hail', 99: 'Thunderstorm with hail',
}

_WMO_ICONS = {
    0: 'clear-day', 1: 'partly-cloudy-day', 2: 'partly-cloudy-day', 3: 'overcast',
    45: 'fog', 48: 'fog',
    51: 'drizzle', 53: 'drizzle', 55: 'drizzle',
    61: 'rain', 63: 'rain', 65: 'rain',
    71: 'snow', 73: 'snow', 75: 'snow',
    80: 'rain', 81: 'rain', 82: 'rain',
    95: 'thunderstorms-rain', 96: 'thunderstorms-rain', 99: 'thunderstorms-rain',
}


def _wmo_label(code):
    return _WMO_LABELS.get(int(code), 'Cloudy')


def _wmo_icon_url(code):
    icon = _WMO_ICONS.get(int(code), 'cloudy')
    return (
        'https://cdn.jsdelivr.net/gh/basmilius/weather-icons@2.0.0/'
        f'production/fill/all/{icon}.svg'
    )


def _parse_lat_lon(query):
    parts = [p.strip() for p in query.split(',', 1)]
    if len(parts) != 2:
        return None
    try:
        return float(parts[0]), float(parts[1])
    except ValueError:
        return None


def _weather_from_weatherapi(city_query):
    if not WEATHER_API_KEY:
        return None
    url = f'https://api.weatherapi.com/v1/current.json?key={WEATHER_API_KEY}&q={quote(city_query)}'
    response = requests.get(url, timeout=15)
    data = response.json()
    if response.status_code != 200:
        err = (data.get('error') or {}).get('message') or 'Weather API request failed'
        raise ValueError(err)
    current = data.get('current') or {}
    location = data.get('location') or {}
    if not current or 'temp_c' not in current:
        return None
    icon = current.get('condition', {}).get('icon') or ''
    if icon.startswith('//'):
        icon = 'https:' + icon
    return {
        'city': location.get('name') or city_query,
        'country': location.get('country') or '',
        'temperature': current.get('temp_c'),
        'condition': (current.get('condition') or {}).get('text') or 'Unknown',
        'icon': icon,
        'humidity': current.get('humidity'),
        'wind': current.get('wind_kph'),
    }


def _weather_from_open_meteo(city_query):
    coords = _parse_lat_lon(city_query)
    if coords:
        lat, lon = coords
        name, country = 'Current location', ''
    else:
        geo_resp = requests.get(
            'https://geocoding-api.open-meteo.com/v1/search',
            params={'name': city_query, 'count': 1, 'language': 'en', 'format': 'json'},
            timeout=15,
        )
        geo_resp.raise_for_status()
        results = (geo_resp.json() or {}).get('results') or []
        if not results:
            raise ValueError(f'City "{city_query}" not found')
        place = results[0]
        lat, lon = place['latitude'], place['longitude']
        name = place.get('name') or city_query
        country = place.get('country') or ''

    wx_resp = requests.get(
        'https://api.open-meteo.com/v1/forecast',
        params={
            'latitude': lat,
            'longitude': lon,
            'current': 'temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code',
            'wind_speed_unit': 'kmh',
        },
        timeout=15,
    )
    wx_resp.raise_for_status()
    current = (wx_resp.json() or {}).get('current') or {}
    code = int(current.get('weather_code') or 0)
    return {
        'city': name,
        'country': country,
        'temperature': current.get('temperature_2m'),
        'condition': _wmo_label(code),
        'icon': _wmo_icon_url(code),
        'humidity': current.get('relative_humidity_2m'),
        'wind': round(float(current.get('wind_speed_10m') or 0), 1),
    }


def _fetch_weather(city_query):
    city_query = (city_query or 'Tirupati').strip() or 'Tirupati'
    try:
        payload = _weather_from_weatherapi(city_query)
        if payload:
            return payload
    except Exception as e:
        print(f'[WARN] WeatherAPI failed for {city_query!r}: {e}')
    return _weather_from_open_meteo(city_query)

# Configure Ollama (local LLM — runs alongside Gemini, not a replacement)
OLLAMA_BASE = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434").rstrip("/")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.2")
OLLAMA_TIMEOUT = int(os.getenv("OLLAMA_TIMEOUT", "120"))

# Twilio Verify (phone OTP during registration)
TWILIO_SID = os.getenv('TWILIO_ACCOUNT_SID')
TWILIO_TOKEN = os.getenv('TWILIO_AUTH_TOKEN')
TWILIO_VERIFY_SID = os.getenv('TWILIO_VERIFY_SERVICE_SID')
twilio_client = (
    TwilioClient(TWILIO_SID, TWILIO_TOKEN)
    if (TwilioClient and TWILIO_SID and TWILIO_TOKEN) else None
)
if not twilio_client:
    print('[WARN] Twilio not configured – phone OTP verification will be unavailable.')


def ask_ollama(prompt: str) -> str:
    url = f"{OLLAMA_BASE}/api/generate"
    payload = {"model": OLLAMA_MODEL, "prompt": prompt, "stream": False}
    r = requests.post(url, json=payload, timeout=OLLAMA_TIMEOUT)
    r.raise_for_status()
    return r.json()["response"]


def chat_ollama(messages: list) -> str:
    url = f"{OLLAMA_BASE}/api/chat"
    payload = {"model": OLLAMA_MODEL, "messages": messages, "stream": False}
    r = requests.post(url, json=payload, timeout=OLLAMA_TIMEOUT)
    r.raise_for_status()
    return r.json()["message"]["content"]


def clean_json_from_llm(text: str) -> str:
    clean_text = text.strip()
    if clean_text.startswith("```"):
        clean_text = clean_text.split("\n", 1)[1].rsplit("\n", 1)[0]
        if clean_text.startswith("json"):
            clean_text = clean_text[4:].strip()
    return clean_text

def _serve_static_subpath(subpath):
    """Resolve nested static URLs (trip share, user QR pages) across frontend/data/assets."""
    subpath = (subpath or '').replace('\\', '/').lstrip('/')
    if not subpath:
        abort(404)

    if subpath.startswith('images/'):
        filename = subpath[len('images/'):]
        return send_from_directory(IMAGES_DIR, filename)

    basename = os.path.basename(subpath)
    if basename in FRONTEND_JS or (basename.endswith('.js') and os.path.isfile(os.path.join(FRONTEND_DIR, basename))):
        return send_from_directory(FRONTEND_DIR, basename)

    if basename.endswith('.html') and os.path.isfile(os.path.join(FRONTEND_DIR, basename)):
        return send_from_directory(FRONTEND_DIR, basename)

    if basename.endswith('.csv') and os.path.isfile(os.path.join(DATA_DIR, basename)):
        return send_from_directory(DATA_DIR, basename)

    if os.path.isfile(os.path.join(IMAGES_DIR, basename)):
        return send_from_directory(IMAGES_DIR, basename)

    abort(404)


def _serve_login_page():
    response = send_from_directory(FRONTEND_DIR, 'login.html')
    response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
    response.headers['Pragma'] = 'no-cache'
    return response


@app.route('/')
def home():
    return _serve_login_page()

@app.route('/dashboard')
def dashboard():
    return send_from_directory(FRONTEND_DIR, 'main_page.html')

@app.route('/images/<path:filename>')
def serve_images(filename):
    return send_from_directory(IMAGES_DIR, filename)

@app.route('/tirupati_main_data.csv')
def serve_main_csv():
    return send_from_directory(DATA_DIR, 'tirupati_main_data.csv')

@app.route('/tirupati_places_with_hospitals.csv')
def serve_hospitals_csv():
    return send_from_directory(DATA_DIR, 'tirupati_places_with_hospitals.csv')

@app.route('/features.js')
def serve_features_js():
    return send_from_directory(FRONTEND_DIR, 'features.js')

@app.route('/chatbot.js')
def serve_chatbot_js():
    return send_from_directory(FRONTEND_DIR, 'chatbot.js')

@app.route('/recommender.js')
def serve_recommender_js():
    return send_from_directory(FRONTEND_DIR, 'recommender.js')

@app.route('/weather.js')
def serve_weather_js():
    return send_from_directory(FRONTEND_DIR, 'weather.js')

@app.route('/emergency-widget.js')
def serve_emergency_widget_js():
    return send_from_directory(FRONTEND_DIR, 'emergency-widget.js')

@app.route('/emergency-widget.css')
def serve_emergency_widget_css():
    return send_from_directory(FRONTEND_DIR, 'emergency-widget.css')

@app.route('/booking.html')
def booking_page():
    return send_from_directory(FRONTEND_DIR, 'booking.html')

@app.route('/packages.html')
def packages_page():
    return send_from_directory(FRONTEND_DIR, 'packages.html')

@app.route('/about.html')
def about_page_html():
    return send_from_directory(FRONTEND_DIR, 'about.html')

@app.route('/main_page.html')
def main_page_html():
    return send_from_directory(FRONTEND_DIR, 'main_page.html')

@app.route('/.well-known/appspecific/com.chrome.devtools.json')
def chrome_devtools():
    return jsonify({})

@app.route('/favicon.ico')
def favicon():
    return '', 204

# In-memory store for package trip QR shares (scan opens /trip/<id>)
_package_shares = {}
_package_shares_lock = Lock()

_LOCAL_HOSTS = frozenset({'127.0.0.1', 'localhost', '::1'})


def _get_lan_ip():
    """Best-effort LAN IPv4 so phone QR scans work (not localhost)."""
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.settimeout(0.4)
        sock.connect(('8.8.8.8', 80))
        ip = sock.getsockname()[0]
        sock.close()
        return ip
    except OSError:
        return None


def get_share_base_url(client_origin=None):
    """
    Base URL encoded in QR codes. Phones cannot open 127.0.0.1 on your PC.
    Priority: PUBLIC_BASE_URL env > client origin (if not local) > LAN IP > request host.
    """
    explicit = (os.getenv('PUBLIC_BASE_URL') or '').strip().rstrip('/')
    if explicit:
        return explicit

    try:
        port = str(urlparse(request.host_url).port or int(os.getenv('PORT', '5000')))
    except (TypeError, ValueError):
        port = os.getenv('PORT', '5000')

    if client_origin:
        try:
            parsed = urlparse(client_origin)
            host = (parsed.hostname or '').lower()
            if host and host not in _LOCAL_HOSTS:
                scheme = parsed.scheme or 'http'
                netloc = parsed.netloc or host
                return f'{scheme}://{netloc}'.rstrip('/')
        except Exception:
            pass

    req_host = (request.host or '').split(':')[0].lower()
    if req_host in _LOCAL_HOSTS:
        lan = _get_lan_ip()
        if lan:
            return f'http://{lan}:{port}'

    return request.host_url.rstrip('/')


def _trip_share_url(share_id, payload=None, client_origin=None):
    if payload and payload.get('shareUrl'):
        return payload['shareUrl']
    return f"{get_share_base_url(client_origin)}/trip/{share_id}"


@app.route('/api/package-share', methods=['POST'])
def create_package_share():
    data = request.get_json(silent=True) or {}
    stops = data.get('stops')
    if not stops or not isinstance(stops, list):
        return jsonify({'status': 'error', 'message': 'Trip must include at least one stop.'}), 400
    share_id = uuid.uuid4().hex[:12]
    client_origin = data.get('clientOrigin')
    trip_url = _trip_share_url(share_id, client_origin=client_origin)
    data['sharedAt'] = datetime.now(timezone.utc).isoformat()
    data['shareUrl'] = trip_url
    with _package_shares_lock:
        _package_shares[share_id] = data
    return jsonify({
        'status': 'ok',
        'shareId': share_id,
        'url': trip_url,
        'scanHint': 'Phone must be on the same Wi‑Fi as this computer.',
    })


@app.route('/api/package-share/<share_id>', methods=['GET', 'PATCH'])
def package_share_detail(share_id):
    if request.method == 'PATCH':
        patch = request.get_json(silent=True) or {}
        with _package_shares_lock:
            payload = _package_shares.get(share_id)
            if not payload:
                return jsonify({'status': 'error', 'message': 'Share not found.'}), 404
            if 'routePath' in patch and isinstance(patch['routePath'], list):
                payload['routePath'] = patch['routePath']
            if 'trip' in patch and isinstance(patch['trip'], dict):
                payload.setdefault('trip', {}).update(patch['trip'])
        return jsonify({'status': 'ok'})

    with _package_shares_lock:
        payload = _package_shares.get(share_id)
    if not payload:
        return jsonify({'status': 'error', 'message': 'Share link expired or not found.'}), 404
    return jsonify({'status': 'ok', 'trip': payload})


@app.route('/trip/<share_id>/<path:subpath>')
def trip_share_nested_assets(share_id, subpath):
    """Serve images, scripts, CSV, etc. when the share page is opened at /trip/<id> (relative URLs)."""
    return _serve_static_subpath(subpath)


@app.route('/trip/<share_id>')
def trip_share_page(share_id):
    return send_from_directory(FRONTEND_DIR, 'packages.html')


@app.route('/api/package-share/<share_id>/qr.png')
def package_share_qr_png(share_id):
    with _package_shares_lock:
        payload = _package_shares.get(share_id)
    if not payload:
        return jsonify({'status': 'error', 'message': 'Share not found.'}), 404
    trip_url = _trip_share_url(share_id, payload=payload)
    try:
        import qrcode
        buf = io.BytesIO()
        qrcode.make(trip_url).save(buf, format='PNG')
        buf.seek(0)
        return send_file(buf, mimetype='image/png', max_age=300)
    except Exception:
        return redirect(
            'https://api.qrserver.com/v1/create-qr-code/?size=200x200&margin=8&data='
            + quote(trip_url, safe=''),
            code=302,
        )


def _finalize_registration(reg_data):
    """Create account after email OTP is verified (phone optional, not SMS-verified)."""
    phone = reg_data.get('phone') or None
    new_user = User(
        username=reg_data['username'],
        email=reg_data['email'].lower(),
        password_hash=generate_password_hash(reg_data['password']),
        phone=phone,
        is_verified=True,
        qr_token=generate_qr_token(),
    )
    db.session.add(new_user)
    db.session.commit()
    ensure_qr_token(new_user)
    return new_user


# Authentication Routes
@app.route('/api/auth/register', methods=['POST'])
def register():
    try:
        data = request.json
        username = data.get('name')
        email = data.get('email', '').strip().lower()
        password = data.get('password')
        raw_phone = (data.get('phone') or '').strip()

        if not email:
            return jsonify({"status": "error", "message": "Email is required"}), 400

        phone = None
        if raw_phone:
            phone = normalize_phone(raw_phone)
            if not phone:
                return jsonify({"status": "error", "message": "Enter a valid 10-digit Indian mobile number"}), 400
            existing_phone = User.query.filter_by(phone=phone).first()
            if existing_phone:
                return jsonify({"status": "error", "message": "Phone number already registered"}), 400

        if User.query.filter_by(email=email).first():
            return jsonify({"status": "error", "message": "Email already registered"}), 400

        otp = str(random.randint(100000, 999999))
        print(f"[DEBUG] Generated email OTP for {email}: {otp}")

        session['registration_data'] = {
            'username': username,
            'email': email,
            'password': password,
            'phone': phone,
            'step': 'email',
            'email_otp': otp,
            'email_otp_expiry': (datetime.now(timezone.utc) + timedelta(minutes=5)).isoformat(),
            'email_verified': False,
        }

        msg = Message('GeoTrip Planner - Verify Your Email', recipients=[email])
        body, html = _build_otp_email(
            username,
            'Use this code to verify your GeoTrip Planner registration.',
            otp,
        )
        msg.body = body
        msg.html = html
        ok, send_err = _send_email_message(msg, otp_hint=otp)
        if not ok:
            session.pop('registration_data', None)
            return jsonify({"status": "error", "message": send_err}), 503

        user_message = "OTP sent to your email inbox"
        if send_err == 'otp_console_fallback':
            user_message = (
                "Email could not be sent (fix Gmail App Password in .env). "
                "Use the OTP shown on screen."
            )
        return jsonify({
            "status": "success",
            "step": "email",
            "message": user_message,
            **_otp_response_extra(send_err, otp),
        })
    except Exception as e:
        print(f"Registration Error: {e}")
        return jsonify({"status": "error", "message": "Registration failed. Please try again."}), 500

@app.route('/api/auth/verify_otp', methods=['POST'])
def verify_otp():
    """Verify email OTP and create account (email required; phone optional)."""
    try:
        data = request.json
        user_otp = data.get('otp')
        reg_data = session.get('registration_data')

        if not reg_data:
            return jsonify({"status": "error", "message": "Session expired. Please register again."}), 400

        if reg_data.get('step') != 'email':
            return jsonify({"status": "error", "message": "Email already verified."}), 400

        expiry = datetime.fromisoformat(reg_data['email_otp_expiry'])
        if datetime.now(timezone.utc) > expiry:
            session.pop('registration_data', None)
            return jsonify({"status": "error", "message": "OTP expired. Please register again."}), 400

        if user_otp != reg_data['email_otp']:
            return jsonify({"status": "error", "message": "Invalid OTP code"}), 400

        reg_data['email_verified'] = True
        new_user = _finalize_registration(reg_data)
        session.pop('registration_data', None)
        print(f"[DEBUG] User {reg_data['email']} verified (email) and created.")
        return jsonify({
            "status": "success",
            "step": "complete",
            "message": "Email verified and account created!",
            "user": user_public_dict(new_user),
        })

    except Exception as e:
        print(f"Verification Error: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route('/api/auth/verify_phone_otp', methods=['POST'])
def verify_phone_otp():
    """Legacy endpoint — phone SMS verification is no longer required."""
    return jsonify({
        "status": "error",
        "message": "Mobile verification is optional. Complete email verification to create your account.",
    }), 400

@app.route('/api/auth/resend_otp', methods=['POST'])
def resend_otp():
    """Resend OTP for whichever step the user is on (email or phone)."""
    try:
        reg_data = session.get('registration_data')
        if not reg_data:
            return jsonify({"status": "error", "message": "Please register first"}), 400

        step = reg_data.get('step', 'email')

        if step == 'email':
            otp = str(random.randint(100000, 999999))
            reg_data['email_otp'] = otp
            reg_data['email_otp_expiry'] = (datetime.now(timezone.utc) + timedelta(minutes=5)).isoformat()
            session['registration_data'] = reg_data

            msg = Message('GeoTrip Planner - Resend OTP', recipients=[reg_data['email']])
            body, html = _build_otp_email(
                reg_data.get('username') or 'there',
                'Here is your new GeoTrip Planner verification code.',
                otp,
            )
            msg.body = body
            msg.html = html
            ok, send_err = _send_email_message(msg, otp_hint=otp)
            if not ok:
                return jsonify({"status": "error", "message": send_err}), 503
            user_message = "New email OTP sent"
            if send_err == 'otp_console_fallback':
                user_message = "SMTP unavailable - use the dev OTP shown below."
            return jsonify({
                "status": "success",
                "step": "email",
                "message": user_message,
                **_otp_response_extra(send_err, otp),
            })

        return jsonify({"status": "error", "message": "Invalid registration step"}), 400
    except Exception as e:
        print(f"Resend OTP Error: {e}")
        return jsonify({"status": "error", "message": "Could not resend OTP."}), 500

@app.route('/api/auth/login', methods=['POST'])
def login():
    try:
        data = request.json
        email = data.get('email', '').strip().lower()
        password = data.get('password')

        user = User.query.filter_by(email=email).first()
        if not user:
            print(f"[DEBUG] Login failed: Email '{email}' not found in database.")
            return jsonify({"status": "error", "message": "Email not found"}), 401

        if check_password_hash(user.password_hash, password):
            session['user_id'] = user.id
            session.permanent = True  # Ensure session persists
            print(f"[DEBUG] Login successful for: {email}")
            client_origin = data.get('clientOrigin')
            return jsonify({
                "status": "success",
                "user": user_public_dict(user, client_origin=client_origin),
            })
        else:
            print(f"[DEBUG] Login failed: Invalid password for '{email}'.")
            return jsonify({"status": "error", "message": "Incorrect password"}), 401
    except Exception as e:
        print(f"Login Error: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/auth/logout', methods=['POST'])
def logout():
    session.clear()
    return jsonify({"status": "success", "message": "Logged out successfully"})


@app.route('/api/auth/me', methods=['GET'])
def auth_me():
    uid = session.get('user_id')
    if not uid:
        return jsonify({"status": "error", "message": "Not logged in"}), 401
    user = db.session.get(User, uid)
    if not user:
        session.clear()
        return jsonify({"status": "error", "message": "User not found"}), 404
    client_origin = request.args.get('clientOrigin')
    return jsonify({"status": "success", "user": user_public_dict(user, client_origin=client_origin)})


# --- Temple QR visit flow ---
@app.route('/user/<identifier>/<path:subpath>')
def user_scan_nested_assets(identifier, subpath):
    """Serve images/scripts when staff opens /user/<token> (relative URLs on main_page)."""
    if not GEOTRIP_ENABLE_QR:
        return redirect('/dashboard')
    if not is_valid_qr_token(identifier):
        return (
            '<!DOCTYPE html><html><body style="font-family:sans-serif;padding:2rem;text-align:center">'
            '<h1>Invalid QR link</h1><p>This personal temple QR link is not valid.</p></body></html>',
            400,
            {'Content-Type': 'text/html; charset=utf-8'},
        )
    return _serve_static_subpath(subpath)


@app.route('/user/<identifier>')
def user_scan_page(identifier):
    if not GEOTRIP_ENABLE_QR:
        return redirect('/dashboard')
    if not is_valid_qr_token(identifier):
        return (
            '<!DOCTYPE html><html><body style="font-family:sans-serif;padding:2rem;text-align:center">'
            '<h1>Invalid QR link</h1><p>This personal temple QR link is not valid.</p></body></html>',
            400,
            {'Content-Type': 'text/html; charset=utf-8'},
        )
    return send_from_directory(FRONTEND_DIR, 'main_page.html')


@app.route('/api/qr/validate/<token>', methods=['GET'])
def validate_qr_token(token):
    blocked = _require_qr()
    if blocked:
        return blocked
    if not is_valid_qr_token(token):
        return jsonify({'status': 'error', 'valid': False, 'message': 'Invalid QR token format.'}), 400
    user = resolve_user(token)
    if not user:
        return jsonify({'status': 'error', 'valid': False, 'message': 'QR token not recognized.'}), 404
    return jsonify({
        'status': 'ok',
        'valid': True,
        'user': {'name': user.username, 'phone': user.phone or ''},
    })


@app.route('/api/qr/generate', methods=['POST'])
def generate_user_qr():
    """Ensure logged-in user has a unique QR token (created once)."""
    blocked = _require_qr()
    if blocked:
        return blocked
    uid = session.get('user_id')
    if not uid:
        return jsonify({'status': 'error', 'message': 'Not logged in'}), 401
    user = db.session.get(User, uid)
    if not user:
        return jsonify({'status': 'error', 'message': 'User not found'}), 404
    client_origin = (request.get_json(silent=True) or {}).get('clientOrigin')
    token = ensure_qr_token(user)
    payload = user_public_dict(user, client_origin=client_origin)
    return jsonify({
        'status': 'ok',
        'created': True,
        'qrToken': token,
        'qrUrl': payload['qrUrl'],
        'user': payload,
    })


@app.route('/api/scan-user/<identifier>', methods=['GET'])
def scan_user_info(identifier):
    blocked = _require_qr()
    if blocked:
        return blocked
    if not is_valid_qr_token(identifier):
        return jsonify({'status': 'error', 'message': 'Invalid QR token.'}), 400
    user = resolve_user(identifier)
    if not user:
        return jsonify({'status': 'error', 'message': 'User not found.'}), 404
    return jsonify({
        'status': 'ok',
        'user': {
            'name': user.username,
            'phone': user.phone or '',
        },
    })


@app.route('/api/temples', methods=['GET'])
def list_temples():
    q = (request.args.get('q') or '').strip()
    query = Temple.query
    if q:
        like = f'%{q}%'
        query = query.filter(
            db.or_(
                Temple.temple_name.ilike(like),
                Temple.full_name.ilike(like),
                Temple.csv_name.ilike(like),
                Temple.location.ilike(like),
            )
        )
    temples = query.order_by(Temple.temple_name.asc()).all()
    return jsonify({
        'status': 'ok',
        'count': len(temples),
        'temples': [
            {
                'id': t.id,
                'templeName': t.temple_name,
                'fullName': t.full_name,
                'location': t.location or '',
                'lat': t.lat,
                'lng': t.lng,
            }
            for t in temples
        ],
    })


def _resolve_visit_user(data):
    """QR scan: all visitor slots (1, 2, …) save under the scanned account email."""
    visitor_number = _parse_visitor_number(data)
    primary_token = (
        data.get('primaryToken') or data.get('scanToken') or ''
    ).strip().upper()
    user_token = (data.get('userToken') or '').strip().upper()
    token = user_token or primary_token

    if token:
        if not is_valid_qr_token(token):
            return None, visitor_number, {'message': 'Invalid QR token.'}, 400
        user = resolve_user(token)
        if user:
            return user, visitor_number, None, None
        return None, visitor_number, {'message': 'QR token not recognized.'}, 404

    uid = session.get('user_id')
    if uid:
        user = db.session.get(User, uid)
        if user:
            return user, visitor_number, None, None

    return None, visitor_number, {'message': 'Valid user token or login required.'}, 401


@app.route('/api/temple-visits', methods=['POST'])
def record_temple_visit():
    blocked = _require_qr()
    if blocked:
        return blocked
    data = request.get_json(silent=True) or {}
    temple_id = data.get('templeId')
    if not temple_id:
        return jsonify({'status': 'error', 'message': 'Temple is required.'}), 400

    user, visitor_number, err_payload, code = _resolve_visit_user(data)
    if err_payload:
        body = {'status': 'error'}
        body.update(err_payload)
        return jsonify(body), code
    if not user:
        return jsonify({'status': 'error', 'message': 'Valid user token or login required.'}), 401

    result, err_payload, code = _record_visit_for_user(user, temple_id, visitor_number=visitor_number)
    if err_payload:
        body = {'status': 'error'}
        if isinstance(err_payload, dict):
            body.update(err_payload)
        else:
            body['message'] = err_payload
        return jsonify(body), code
    return jsonify(result)


@app.route('/api/temple-visits/history', methods=['GET'])
def temple_visit_history():
    blocked = _require_qr()
    if blocked:
        return blocked
    uid = session.get('user_id')
    if not uid:
        return jsonify({'status': 'error', 'message': 'Not logged in'}), 401
    limit = min(int(request.args.get('limit', 30)), 100)
    rows = (
        TempleVisit.query.filter_by(user_id=uid)
        .order_by(TempleVisit.visit_date.desc(), TempleVisit.updated_at.desc())
        .limit(limit)
        .all()
    )
    return jsonify({
        'status': 'ok',
        'history': [
            {
                'id': v.id,
                'templeId': v.temple_id,
                'templeName': v.temple.temple_name if v.temple else '',
                'fullName': v.temple.full_name if v.temple else '',
                'visitDate': v.visit_date.isoformat(),
                'visitCount': v.visit_count,
                'visitorNumber': getattr(v, 'visitor_number', None) or 1,
                'visitorLabel': f'Visitor {getattr(v, "visitor_number", None) or 1}',
                'createdAt': v.created_at.isoformat() if v.created_at else None,
            }
            for v in rows
        ],
    })


@app.route('/api/temple-visits/visited-temples', methods=['GET'])
def visited_temples_list():
    """Distinct temples this user has checked into (aggregated)."""
    blocked = _require_qr()
    if blocked:
        return blocked
    uid = session.get('user_id')
    if not uid:
        return jsonify({'status': 'error', 'message': 'Not logged in'}), 401

    rows = (
        TempleVisit.query.filter_by(user_id=uid)
        .order_by(TempleVisit.visit_date.desc())
        .all()
    )
    by_temple = {}
    for v in rows:
        tid = v.temple_id
        if tid not in by_temple:
            by_temple[tid] = {
                'templeId': tid,
                'templeName': v.temple.temple_name if v.temple else '',
                'fullName': v.temple.full_name if v.temple else '',
                'location': (v.temple.location or '') if v.temple else '',
                'totalVisits': 0,
                'visitDays': 0,
                'lastVisitDate': v.visit_date.isoformat(),
            }
        entry = by_temple[tid]
        entry['totalVisits'] += v.visit_count or 0
        entry['visitDays'] += 1
        if v.visit_date.isoformat() > entry['lastVisitDate']:
            entry['lastVisitDate'] = v.visit_date.isoformat()

    temples = sorted(by_temple.values(), key=lambda x: x['lastVisitDate'], reverse=True)
    return jsonify({
        'status': 'ok',
        'count': len(temples),
        'visitedTemples': temples,
    })


@app.route('/api/temple-visits/analytics', methods=['GET'])
def temple_visit_analytics():
    blocked = _require_qr()
    if blocked:
        return blocked
    uid = session.get('user_id')
    if not uid:
        return jsonify({'status': 'error', 'message': 'Not logged in'}), 401
    today = date.today()
    today_rows = TempleVisit.query.filter_by(user_id=uid, visit_date=today).all()
    all_rows = TempleVisit.query.filter_by(user_id=uid).all()

    visits_today_total = sum((r.visit_count or 0) for r in today_rows)
    temples_today = len({r.temple_id for r in today_rows})
    lifetime_visits = sum((r.visit_count or 0) for r in all_rows)

    by_temple_today = [
        {
            'templeId': r.temple_id,
            'templeName': r.temple.temple_name if r.temple else '',
            'visitCount': r.visit_count,
            'visitorNumber': getattr(r, 'visitor_number', None) or 1,
            'visitorLabel': f'Visitor {getattr(r, "visitor_number", None) or 1}',
        }
        for r in today_rows
    ]

    return jsonify({
        'status': 'ok',
        'date': today.isoformat(),
        'visitsTodayTotal': visits_today_total,
        'templesVisitedToday': temples_today,
        'lifetimeVisitCount': lifetime_visits,
        'todayByTemple': by_temple_today,
    })


@app.route('/api/user/me/qr.png')
def my_user_qr_png():
    blocked = _require_qr()
    if blocked:
        return blocked
    uid = session.get('user_id')
    if not uid:
        return jsonify({'status': 'error', 'message': 'Not logged in'}), 401
    user = db.session.get(User, uid)
    if not user:
        return jsonify({'status': 'error', 'message': 'User not found'}), 404
    return _user_qr_png_response(user)


@app.route('/api/user/<identifier>/qr.png')
def user_qr_png(identifier):
    blocked = _require_qr()
    if blocked:
        return blocked
    ident = str(identifier).strip().upper()
    user = None
    if is_valid_qr_token(ident):
        user = resolve_user(ident)
    elif session.get('user_id') and str(session['user_id']) == str(identifier):
        user = db.session.get(User, session['user_id'])
    if not user:
        return jsonify({'status': 'error', 'message': 'User not found'}), 404
    return _user_qr_png_response(user)


def _user_qr_png_response(user):
    client_origin = request.args.get('clientOrigin')
    scan_url = user_public_dict(user, client_origin=client_origin)['qrUrl']
    try:
        import qrcode
        buf = io.BytesIO()
        qrcode.make(scan_url).save(buf, format='PNG')
        buf.seek(0)
        return send_file(buf, mimetype='image/png', max_age=120)
    except Exception:
        return redirect(
            'https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=8&data='
            + quote(scan_url, safe=''),
            code=302,
        )

@app.route('/api/auth/forgot_password', methods=['POST'])
def forgot_password():
    try:
        data = request.json
        email = data.get('email', '').strip().lower()
        user = User.query.filter_by(email=email).first()
        if not user:
            return jsonify({"status": "error", "message": "Email address not registered"}), 404

        otp = str(random.randint(100000, 999999))
        session['reset_data'] = {
            'email': email,
            'otp': otp,
            'expiry': (datetime.now(timezone.utc) + timedelta(minutes=5)).isoformat()
        }

        print(f"[DEBUG] Password reset OTP for {email}: {otp}")

        msg = Message('GeoTrip Planner - Password Reset Verification', recipients=[email])
        body, html = _build_otp_email(
            user.username,
            'You requested a password reset for your GeoTrip Planner account.',
            otp,
        )
        msg.body = body
        msg.html = html
        ok, send_err = _send_email_message(msg, otp_hint=otp)
        if not ok:
            session.pop('reset_data', None)
            return jsonify({"status": "error", "message": send_err}), 503
        user_message = "Reset OTP sent to your email inbox"
        if send_err == 'otp_console_fallback':
            user_message = (
                "Email could not be sent (fix Gmail App Password in .env). "
                "Use the OTP shown on screen."
            )
        return jsonify({
            "status": "success",
            "message": user_message,
            **_otp_response_extra(send_err, otp),
        })
    except Exception as e:
        print(f"Forgot Password Error: {e}")
        return jsonify({"status": "error", "message": "Could not send reset email."}), 500

@app.route('/api/auth/reset_password', methods=['POST'])
def reset_password():
    try:
        data = request.json
        email = data.get('email', '').strip().lower()
        user_otp = data.get('otp')
        new_password = data.get('new_password')

        reset_data = session.get('reset_data')
        if not reset_data or reset_data['email'] != email:
            return jsonify({"status": "error", "message": "Reset session expired or invalid. Please request OTP again."}), 400

        expiry = datetime.fromisoformat(reset_data['expiry'])
        if datetime.now(timezone.utc) > expiry:
            session.pop('reset_data', None)
            return jsonify({"status": "error", "message": "OTP expired"}), 400

        if str(user_otp or '').strip() == str(reset_data['otp']).strip():
            user = User.query.filter_by(email=email).first()
            if not user:
                return jsonify({"status": "error", "message": "User not found"}), 404

            if not new_password or len(str(new_password)) < 6:
                return jsonify({"status": "error", "message": "Password must be at least 6 characters"}), 400

            user.password_hash = generate_password_hash(new_password)
            db.session.commit()
            session.pop('reset_data', None)
            print(f"[DEBUG] Password successfully reset for user: {email}")
            return jsonify({"status": "success", "message": "Password updated successfully! You can now login."})
        else:
            return jsonify({"status": "error", "message": "Invalid OTP code"}), 400
    except Exception as e:
        print(f"Reset Password Error: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/weather')
def get_weather():
    city = request.args.get('city', 'Tirupati')
    try:
        payload = _fetch_weather(city)
        return jsonify(payload)
    except Exception as e:
        print(f'[ERROR] Weather fetch failed for {city!r}: {e}')
        return jsonify({'error': str(e) or 'Could not fetch weather'}), 500

@app.route('/api/recommend', methods=['POST'])
def recommend():
    blocked = _require_ai()
    if blocked:
        return blocked
    try:
        data = request.json
        destination = data.get('destination', 'Tirupati')
        budget = data.get('budget', 'medium')
        interests = data.get('interests', 'temples, nature')
        
        prompt = f"Create a 3-day itinerary for {destination}. Budget: {budget}. Interests: {interests}. Return the itinerary ONLY as a JSON array of daily objects, each containing 'day', 'activities' (array of strings), and 'tips'."
        
        if not client:
            return jsonify({"status": "error", "message": "Gemini API key not configured"}), 500
            
        response = client.models.generate_content(model='gemini-1.5-flash', contents=prompt)
        clean_text = clean_json_from_llm(response.text)
        return jsonify({"status": "success", "recommendation": json.loads(clean_text), "provider": "gemini"})
    except Exception as e:
        print(f"Recommend Error: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route('/api/recommend-ollama', methods=['POST'])
def recommend_ollama():
    blocked = _require_ai()
    if blocked:
        return blocked
    try:
        data = request.json or {}
        destination = data.get('destination', 'Tirupati')
        budget = data.get('budget', 'medium')
        interests = data.get('interests', 'temples, nature')

        prompt = (
            f"Create a 3-day itinerary for {destination}. Budget: {budget}. Interests: {interests}. "
            "Return the itinerary ONLY as a JSON array of daily objects, each containing "
            "'day', 'activities' (array of strings), and 'tips'. No markdown, no extra text."
        )

        raw = ask_ollama(prompt)
        clean_text = clean_json_from_llm(raw)
        return jsonify({
            "status": "success",
            "recommendation": json.loads(clean_text),
            "provider": "ollama",
            "model": OLLAMA_MODEL,
        })
    except requests.exceptions.ConnectionError:
        return jsonify({
            "status": "error",
            "message": "Cannot reach Ollama. Start Ollama (ollama serve) and ensure the model is pulled.",
        }), 503
    except requests.exceptions.HTTPError as e:
        print(f"Ollama HTTP Error: {e}")
        return jsonify({"status": "error", "message": f"Ollama error: {e}"}), 502
    except json.JSONDecodeError as e:
        print(f"Ollama JSON parse Error: {e}")
        return jsonify({"status": "error", "message": "Ollama returned invalid JSON. Try again."}), 500
    except Exception as e:
        print(f"Recommend Ollama Error: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route('/api/chat', methods=['POST'])
def api_chat():
    blocked = _require_ai()
    if blocked:
        return blocked
    try:
        data = request.json or {}
        message = (data.get('message') or '').strip()
        if not message:
            return jsonify({"status": "error", "message": "Message is required"}), 400

        system_prompt = (
            "You are GeoTrip Assistant for Tirupati and Tirumala trip planning in India. "
            "Help users with temples, darshan timing, local food, transport, budgets, and itinerary tips. "
            "Keep answers concise, practical, and friendly. If unsure, suggest using the app's planner or booking pages."
        )
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": message},
        ]
        reply = chat_ollama(messages)
        return jsonify({
            "status": "success",
            "reply": reply,
            "provider": "ollama",
            "model": OLLAMA_MODEL,
        })
    except requests.exceptions.ConnectionError:
        return jsonify({
            "status": "error",
            "message": "Cannot reach Ollama. Start Ollama and verify OLLAMA_BASE_URL in .env.",
        }), 503
    except requests.exceptions.HTTPError as e:
        print(f"Ollama Chat HTTP Error: {e}")
        return jsonify({"status": "error", "message": f"Ollama error: {e}"}), 502
    except Exception as e:
        print(f"Chat Error: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route('/api/agent', methods=['POST'])
def api_agent():
    """GeoTrip ADK agent — recommendations, itinerary, weather, emergency."""
    blocked = _require_ai()
    if blocked:
        return blocked
    try:
        from agent_runner import run_geotrip_agent

        data = request.json or {}
        message = (data.get('message') or '').strip()
        if not message:
            return jsonify({'status': 'error', 'message': 'Message is required'}), 400

        lat = data.get('lat')
        lng = data.get('lng')
        try:
            lat = float(lat) if lat is not None else None
            lng = float(lng) if lng is not None else None
        except (TypeError, ValueError):
            lat, lng = None, None

        user_id = str(data.get('user_id') or session.get('user_id') or 'geotrip_user')
        session_id = data.get('session_id')
        provider = (data.get('provider') or 'gemini').strip().lower()

        if provider in ('ollama', 'gemma', 'gemma3', 'local'):
            from ollama_agent_runner import run_ollama_agent
            result = run_ollama_agent(
                message,
                user_id=user_id,
                session_id=session_id,
                lat=lat,
                lng=lng,
            )
        else:
            result = run_geotrip_agent(
                message,
                user_id=user_id,
                session_id=session_id,
                lat=lat,
                lng=lng,
            )
        if result.get('status') == 'error':
            return jsonify(result), 400
        return jsonify(result)
    except Exception as e:
        print(f'Agent Error: {e}')
        return jsonify({'status': 'error', 'message': str(e)}), 500


# --- Admin Panel ---
def _require_admin():
    if not session.get('is_admin'):
        return jsonify({'status': 'error', 'message': 'Admin login required'}), 401
    return None


@app.route('/about')
def about_page():
    return send_from_directory(FRONTEND_DIR, 'about.html')


@app.route('/admin')
def admin_page():
    return _serve_login_page()


@app.route('/api/admin/login', methods=['POST'])
def admin_login():
    data = request.json or {}
    username = (data.get('username') or '').strip()
    password = (data.get('password') or '').strip()
    admin = Admin.query.filter(
        db.func.lower(Admin.username) == username.lower()
    ).first()
    if not admin or not check_password_hash(admin.password_hash, password):
        return jsonify({'status': 'error', 'message': 'Invalid admin credentials'}), 401
    session['is_admin'] = True
    session['admin_username'] = admin.username
    return jsonify({'status': 'success', 'message': 'Admin login successful'})


@app.route('/api/admin/logout', methods=['POST'])
def admin_logout():
    session.pop('is_admin', None)
    session.pop('admin_username', None)
    return jsonify({'status': 'success', 'message': 'Logged out'})


@app.route('/api/admin/me', methods=['GET'])
def admin_me():
    if not session.get('is_admin'):
        return jsonify({'status': 'ok', 'loggedIn': False})
    return jsonify({'status': 'success', 'loggedIn': True, 'username': session.get('admin_username', 'admin')})


@app.route('/api/admin/stats', methods=['GET'])
def admin_stats():
    err = _require_admin()
    if err:
        return err
    total_users = User.query.count()
    verified_users = User.query.filter_by(is_verified=True).count()
    total_temples = Temple.query.count()
    total_visits = db.session.query(db.func.coalesce(db.func.sum(TempleVisit.visit_count), 0)).scalar()
    unique_visitors = db.session.query(db.func.count(db.func.distinct(TempleVisit.user_id))).scalar()
    today = date.today()
    # Count unique visitor-temple rows for today (repeat taps on same temple do not inflate)
    visits_today = db.session.query(db.func.count(TempleVisit.id)).filter(
        TempleVisit.visit_date == today
    ).scalar()
    return jsonify({
        'status': 'ok',
        'totalUsers': total_users,
        'verifiedUsers': verified_users,
        'totalTemples': total_temples,
        'totalVisits': int(total_visits),
        'uniqueVisitors': int(unique_visitors),
        'visitsToday': int(visits_today),
    })


@app.route('/api/admin/users', methods=['GET'])
def admin_users():
    err = _require_admin()
    if err:
        return err
    today = date.today()
    users = User.query.order_by(User.created_at.desc()).all()
    result = []
    for u in users:
        all_visits = TempleVisit.query.filter_by(user_id=u.id).all()
        today_visits = [v for v in all_visits if v.visit_date == today]
        total = len(all_visits)
        today_total = len(today_visits)
        last_visit = max((v.visit_date for v in all_visits), default=None)
        result.append({
            'id': u.id,
            'username': u.username,
            'email': u.email,
            'phone': u.phone or '',
            'visitsToday': today_total,
            'totalVisits': total,
            'lastVisitDate': last_visit.isoformat() if last_visit else '',
            'isVerified': u.is_verified,
            'createdAt': u.created_at.isoformat() if u.created_at else '',
        })
    return jsonify({'status': 'ok', 'users': result})


@app.route('/api/admin/visits', methods=['GET'])
def admin_visits():
    err = _require_admin()
    if err:
        return err
    limit = min(int(request.args.get('limit', 100)), 500)
    rows = (
        TempleVisit.query
        .order_by(TempleVisit.visit_date.desc(), TempleVisit.updated_at.desc())
        .limit(limit)
        .all()
    )
    return jsonify({
        'status': 'ok',
        'visits': [
            {
                'id': v.id,
                'userName': v.user.username if v.user else '',
                'userEmail': v.user.email if v.user else '',
                'visitorNumber': getattr(v, 'visitor_number', None) or 1,
                'visitorLabel': f'Visitor {getattr(v, "visitor_number", None) or 1}',
                'templeName': v.temple.temple_name if v.temple else '',
                'visitDate': v.visit_date.isoformat(),
                # Visits tab shows unique entry count per visitor+temple+date
                'visitCount': 1,
                'rawVisitCount': v.visit_count,
                'createdAt': v.created_at.isoformat() if v.created_at else '',
            }
            for v in rows
        ],
    })


@app.route('/api/admin/users/<int:user_id>/details', methods=['GET'])
def admin_user_details(user_id):
    """Per-user visit analytics for the admin panel."""
    err = _require_admin()
    if err:
        return err
    user = db.session.get(User, user_id)
    if not user:
        return jsonify({'status': 'error', 'message': 'User not found'}), 404

    today = date.today()
    all_visits = TempleVisit.query.filter_by(user_id=user.id).order_by(
        TempleVisit.visit_date.desc(), TempleVisit.updated_at.desc()
    ).all()
    today_visits = [v for v in all_visits if v.visit_date == today]

    by_visitor_today = {}
    for v in today_visits:
        vn = getattr(v, 'visitor_number', None) or 1
        if vn not in by_visitor_today:
            by_visitor_today[vn] = {'visitorNumber': vn, 'visitsToday': 0, 'templeIds': set()}
        by_visitor_today[vn]['visitsToday'] += 1
        by_visitor_today[vn]['templeIds'].add(v.temple_id)
    visitors_today = [
        {
            'visitorNumber': vn,
            'visitorLabel': f'Visitor {vn}',
            'visitsToday': info['visitsToday'],
            'templesToday': len(info['templeIds']),
        }
        for vn, info in sorted(by_visitor_today.items())
    ]

    by_temple = {}
    for v in all_visits:
        tid = v.temple_id
        vn = getattr(v, 'visitor_number', None) or 1
        if tid not in by_temple:
            by_temple[tid] = {
                'templeId': tid,
                'templeName': v.temple.temple_name if v.temple else '',
                'location': (v.temple.location or '') if v.temple else '',
                'visitsToday': 0,
                'visitorsTodaySet': set(),
                'lifetime': 0,
                'lastDate': v.visit_date.isoformat(),
                'byVisitor': {},
            }
        if vn not in by_temple[tid]['byVisitor']:
            by_temple[tid]['byVisitor'][vn] = {'visitsToday': 0, 'lifetime': 0}
        by_temple[tid]['byVisitor'][vn]['lifetime'] += 1
        by_temple[tid]['lifetime'] += 1
        if v.visit_date == today:
            by_temple[tid]['visitsToday'] += 1
            by_temple[tid]['visitorsTodaySet'].add(vn)
            by_temple[tid]['byVisitor'][vn]['visitsToday'] += 1
        if v.visit_date.isoformat() > by_temple[tid]['lastDate']:
            by_temple[tid]['lastDate'] = v.visit_date.isoformat()

    temple_stats = []
    for tid, info in by_temple.items():
        temple_stats.append({
            'templeId': info['templeId'],
            'templeName': info['templeName'],
            'location': info['location'],
            'visitsToday': info['visitsToday'],
            'templesToday': len(info['visitorsTodaySet']),
            'lifetime': info['lifetime'],
            'lastDate': info['lastDate'],
            'visitors': [
                {
                    'visitorNumber': vn,
                    'visitorLabel': f'Visitor {vn}',
                    'visitsToday': vinfo['visitsToday'],
                    'lifetime': vinfo['lifetime'],
                }
                for vn, vinfo in sorted(info['byVisitor'].items())
            ],
        })
    temple_stats.sort(key=lambda x: (x['visitsToday'], x['lastDate']), reverse=True)

    visited_temples = [
        {
            'templeName': t['templeName'],
            'location': t['location'],
            'visitsToday': t['visitsToday'],
            'templesToday': t['templesToday'],
            'lifetime': t['lifetime'],
            'lastDate': t['lastDate'],
        }
        for t in temple_stats
    ]

    lifetime_visits_primary = len([
        v for v in all_visits if (getattr(v, 'visitor_number', None) or 1) == 1
    ])

    return jsonify({
        'status': 'ok',
        'user': {
            'id': user.id,
            'username': user.username,
            'email': user.email,
            'phone': user.phone or '',
        },
        'visitsToday': len(today_visits),
        'templesToday': len({v.temple_id for v in today_visits}),
        'visitorsToday': visitors_today,
        'templeStats': temple_stats,
        # Lifetime card should represent only the account holder (Visitor 1)
        'lifetimeVisits': lifetime_visits_primary,
        'visitedTemples': visited_temples,
        'history': [
            {
                'templeName': v.temple.temple_name if v.temple else '',
                'visitDate': v.visit_date.isoformat(),
                'visitCount': 1,
                'visitorNumber': getattr(v, 'visitor_number', None) or 1,
                'visitorLabel': f'Visitor {getattr(v, "visitor_number", None) or 1}',
            }
            for v in all_visits[:50]
        ],
    })


@app.route('/api/admin/users/<int:user_id>', methods=['DELETE'])
def admin_delete_user(user_id):
    err = _require_admin()
    if err:
        return err
    user = db.session.get(User, user_id)
    if not user:
        return jsonify({'status': 'error', 'message': 'User not found'}), 404
    email = user.email
    username = user.username
    TempleVisit.query.filter_by(user_id=user.id).delete()
    db.session.delete(user)
    db.session.commit()
    return jsonify({
        'status': 'ok',
        'message': f'User "{username}" ({email}) and all visit records deleted',
        'deletedUserId': user_id,
    })


@app.route('/api/admin/users/bulk-delete', methods=['POST'])
def admin_bulk_delete_users():
    err = _require_admin()
    if err:
        return err
    data = request.json or {}
    raw_ids = data.get('user_ids') or []
    if not isinstance(raw_ids, list) or not raw_ids:
        return jsonify({'status': 'error', 'message': 'No users selected'}), 400

    deleted_ids = []
    for raw_id in raw_ids:
        try:
            user_id = int(raw_id)
        except (TypeError, ValueError):
            continue
        user = db.session.get(User, user_id)
        if not user:
            continue
        TempleVisit.query.filter_by(user_id=user.id).delete()
        db.session.delete(user)
        deleted_ids.append(user_id)

    if not deleted_ids:
        return jsonify({'status': 'error', 'message': 'No matching users found'}), 404

    db.session.commit()
    return jsonify({
        'status': 'ok',
        'message': f'Deleted {len(deleted_ids)} user(s) and their visit records',
        'deletedUserIds': deleted_ids,
        'deletedCount': len(deleted_ids),
    })


@app.route('/api/admin/visits/bulk-delete', methods=['POST'])
def admin_bulk_delete_visits():
    err = _require_admin()
    if err:
        return err
    data = request.json or {}
    raw_ids = data.get('visit_ids') or []
    if not isinstance(raw_ids, list) or not raw_ids:
        return jsonify({'status': 'error', 'message': 'No visits selected'}), 400

    visit_ids = []
    for raw_id in raw_ids:
        try:
            visit_ids.append(int(raw_id))
        except (TypeError, ValueError):
            continue

    if not visit_ids:
        return jsonify({'status': 'error', 'message': 'No valid visit IDs'}), 400

    deleted_count = (
        TempleVisit.query
        .filter(TempleVisit.id.in_(visit_ids))
        .delete(synchronize_session=False)
    )
    if not deleted_count:
        return jsonify({'status': 'error', 'message': 'No matching visits found'}), 404

    db.session.commit()
    return jsonify({
        'status': 'ok',
        'message': f'Deleted {deleted_count} visit record(s)',
        'deletedCount': deleted_count,
    })


if __name__ == '__main__':
    _check_mail_config()
    # 0.0.0.0 so browser works without Cursor port-forward; use http://127.0.0.1:5000
    app.run(debug=True, host='0.0.0.0', port=5000)
