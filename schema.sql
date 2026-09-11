-- =========================================================
-- SkillTrack / KaushalSetu - SIH26135
-- PostgreSQL Database Schema
-- =========================================================

CREATE TABLE IF NOT EXISTS trainees (
    id SERIAL PRIMARY KEY,
    trainee_id VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(150) NOT NULL,
    phone VARCHAR(20),
    district VARCHAR(100),
    registration_date DATE DEFAULT CURRENT_DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);


CREATE TABLE IF NOT EXISTS training_centers (
    id SERIAL PRIMARY KEY,
    center_id VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(200) NOT NULL,
    district VARCHAR(100),
    state VARCHAR(100) DEFAULT 'Maharashtra',
    grade VARCHAR(20),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);


CREATE TABLE IF NOT EXISTS courses (
    id SERIAL PRIMARY KEY,
    course_id VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(200) NOT NULL,
    sector VARCHAR(100) NOT NULL,
    duration_months INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);


CREATE TABLE IF NOT EXISTS enrollments (
    id SERIAL PRIMARY KEY,

    trainee_id INTEGER NOT NULL
        REFERENCES trainees(id)
        ON DELETE CASCADE,

    course_id INTEGER NOT NULL
        REFERENCES courses(id)
        ON DELETE RESTRICT,

    center_id INTEGER
        REFERENCES training_centers(id)
        ON DELETE SET NULL,

    batch_id VARCHAR(50),

    enrollment_date DATE,
    completion_date DATE,

    status VARCHAR(30) DEFAULT 'Enrolled',

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);


CREATE TABLE IF NOT EXISTS employment (
    id SERIAL PRIMARY KEY,

    trainee_id INTEGER NOT NULL
        REFERENCES trainees(id)
        ON DELETE CASCADE,

    status VARCHAR(50) NOT NULL,

    company VARCHAR(200),
    role VARCHAR(200),

    salary NUMERIC(12,2),

    employment_date DATE,

    verification_source VARCHAR(50),

    verified BOOLEAN DEFAULT FALSE,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);


CREATE TABLE IF NOT EXISTS job_demand (
    id SERIAL PRIMARY KEY,

    company VARCHAR(200) NOT NULL,
    role VARCHAR(200) NOT NULL,

    sector VARCHAR(100),

    openings INTEGER NOT NULL DEFAULT 0,

    district VARCHAR(100),

    source VARCHAR(100),

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);


CREATE TABLE IF NOT EXISTS outcome_responses (
    id SERIAL PRIMARY KEY,

    trainee_id INTEGER
        REFERENCES trainees(id)
        ON DELETE SET NULL,

    phone VARCHAR(20),

    response_text TEXT NOT NULL,

    employment_status VARCHAR(50),

    source VARCHAR(50) DEFAULT 'WhatsApp',

    verified BOOLEAN DEFAULT FALSE,

    message_id VARCHAR(200),

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);


-- =========================================================
-- Useful indexes
-- =========================================================

CREATE INDEX IF NOT EXISTS idx_trainees_phone
    ON trainees(phone);

CREATE INDEX IF NOT EXISTS idx_trainees_district
    ON trainees(district);

CREATE INDEX IF NOT EXISTS idx_enrollments_trainee
    ON enrollments(trainee_id);

CREATE INDEX IF NOT EXISTS idx_employment_trainee
    ON employment(trainee_id);

CREATE INDEX IF NOT EXISTS idx_employment_status
    ON employment(status);

CREATE INDEX IF NOT EXISTS idx_job_demand_sector
    ON job_demand(sector);

CREATE INDEX IF NOT EXISTS idx_job_demand_district
    ON job_demand(district);

CREATE INDEX IF NOT EXISTS idx_outcome_responses_created
    ON outcome_responses(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_outcome_responses_phone
    ON outcome_responses(phone);
