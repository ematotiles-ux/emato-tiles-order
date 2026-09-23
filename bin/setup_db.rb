#!/usr/bin/env ruby
# frozen_string_literal: true

require_relative '../server'

puts "=========================================================="
puts "  emato® TILES - Unified Database Setup & Migration"
puts "  Target DB: #{DB_PATH}"
puts "=========================================================="

ensure_database_initialized!

db = SQLite3::Database.new(DB_PATH)
count = db.get_first_value("SELECT COUNT(*) FROM orders").to_i
db.close

puts "=========================================================="
puts "  Database ready with #{count} orders."
puts "=========================================================="
