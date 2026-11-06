# SchoolBridge — Architecture Notes

## Product target

A Windows-installed school management application for primary and secondary schools, initially targeting Uganda. It must support schools with no internet connection.

## Deployment modes

### 1. Single-computer mode
The Windows computer runs the user interface, local API service and local database. SQLite is suitable for this single-computer mode.

### 2. School LAN mode
A designated school computer runs the API and PostgreSQL database. Staff connect using a browser on phones or computers over the school's Wi-Fi or local hotspot. Internet access is not required for local communication.

### 3. Larger school mode
A dedicated local server runs the API and PostgreSQL database for concurrent users across the school network.

**Important:** SQLite database files must not be shared directly over a network between multiple computers. Multi-user LAN deployments use PostgreSQL through the API.

## Initial technology direction

- Backend: Python + FastAPI
- Data access: SQLAlchemy
- Database: SQLite for single-computer deployments; PostgreSQL for LAN/server deployments
- Frontend: responsive web interface, packaged for Windows desktop use
- Desktop packaging: to be selected after a working application prototype
- Development: GitHub repository + GitHub Codespaces

This is an initial direction, not a final packaging decision. Windows installation, local service startup, network access, upgrades and backup/restore must be tested on real Windows 10/11 machines before release.

## Security requirements

- Separate data and configuration for each school's installation.
- Authentication and role-based permissions.
- Teachers can only access assigned classes and subjects.
- Secure password hashing; never store plain-text passwords.
- Audit important actions such as marks changes, fee edits and user permission changes.
- Validate inputs and protect against common web vulnerabilities.
- Backups must be restorable and exportable.
- Do not use real student or staff personal data in development.

## First milestones

1. Establish the API and automated checks.
2. Design school, user, role, student, class and subject data models.
3. Implement authentication and permissions.
4. Build student and staff administration.
5. Add attendance, examinations, grading and report cards.
6. Add fees, receipts and finance reports.
7. Build the responsive staff interface.
8. Package and test the Windows offline installation.
