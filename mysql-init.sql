-- Grant all privileges to temporal user
GRANT ALL PRIVILEGES ON *.* TO 'temporal'@'%' WITH GRANT OPTION;
FLUSH PRIVILEGES;

-- Create visibility database
CREATE DATABASE IF NOT EXISTS temporal_visibility;