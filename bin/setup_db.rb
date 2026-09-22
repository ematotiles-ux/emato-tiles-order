#!/usr/bin/env ruby
# frozen_string_literal: true

require 'sqlite3'
require 'json'
require 'fileutils'

root_dir = File.expand_path('..', __dir__)
db_file = ENV['DATABASE_PATH'] || File.join(root_dir, 'eod.db')
schema_file = File.join(root_dir, 'schema.sql')
json_file = File.join(root_dir, 'orders.json')

puts "=========================================================="
puts "  emato® TILES - Database Setup & Migration"
puts "  Target DB: #{db_file}"
puts "=========================================================="

FileUtils.mkdir_p(File.dirname(db_file))

db = SQLite3::Database.new(db_file)
db.results_as_hash = true

# 1. Check if orders table exists
table_exists = db.get_first_value("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='orders'").to_i > 0

if table_exists
  puts "==> [OK] Table 'orders' already exists. Preserving existing records."
else
  puts "==> [INIT] Creating tables, views, and indices from schema.sql..."
  if File.file?(schema_file)
    db.execute_batch(File.read(schema_file))
    puts "==> [OK] Schema successfully applied."
  else
    warn "==> [ERROR] schema.sql not found at #{schema_file}!"
    exit 1
  end
end

# 2. Check record count
count = db.get_first_value("SELECT COUNT(*) FROM orders").to_i

if count.zero?
  puts "==> [SEED] Database is empty. Loading initial orders from orders.json..."
  if File.file?(json_file)
    records = JSON.parse(File.read(json_file))
    if records.is_a?(Array) && !records.empty?
      db.transaction do
        records.each do |r|
          db.execute(
            <<-SQL,
            INSERT OR IGNORE INTO orders (
              id, order_no, place_date, status, party_type, manage_by, client_name, city, state,
              factory_name, size, product, finish_optional, grade,
              box_qty, box_weight, total_weight, remark
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            SQL
            [
              r['id'],
              r['order_no'] || "EM-#{1000 + (r['id'] || 1).to_i}",
              r['place_date'],
              r['status'] || 'NOT READY',
              r['party_type'] || 'DEALER',
              r['manage_by'] || 'UNASSIGNED',
              r['client_name'] || '',
              r['city'] || '',
              r['state'] || '',
              r['factory_name'] || '',
              r['size'] || '',
              r['product'] || '',
              r['finish_optional'] || '',
              r['grade'] || 'PRM',
              r['box_qty'] || 0,
              r['box_weight'] || 0.0,
              r['total_weight'] || 0.0,
              r['remark'] || ''
            ]
          )
        end
      end
      count = db.get_first_value("SELECT COUNT(*) FROM orders").to_i
      puts "==> [OK] Successfully seeded #{count} orders into database."
    else
      puts "==> [INFO] orders.json is empty. Starting with a fresh database."
    end
  else
    puts "==> [INFO] orders.json not found. Database ready for new orders."
  end
else
  puts "==> [OK] Database contains #{count} orders. No seeding needed."
end

db.close
puts "=========================================================="
puts "  Database setup completed successfully."
puts "=========================================================="
