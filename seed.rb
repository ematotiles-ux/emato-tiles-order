#!/usr/bin/env ruby
# frozen_string_literal: true

require 'sqlite3'
require 'json'
require 'fileutils'

db_file = File.join(__dir__, 'eod.db')
schema_file = File.join(__dir__, 'schema.sql')
json_file = File.join(__dir__, 'orders.json')

puts "==> Rebuilding #{db_file} from #{json_file}..."
FileUtils.rm_f(db_file)

db = SQLite3::Database.new(db_file)
db.results_as_hash = true

schema_sql = File.read(schema_file)
db.execute_batch(schema_sql)

records = JSON.parse(File.read(json_file))
records.each do |r|
  db.execute(
    <<-SQL,
    INSERT INTO orders (
      id, place_date, status, party_type, manage_by, client_name, city, state,
      factory_name, size, product, finish_optional, grade,
      box_qty, box_weight, total_weight, remark
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    SQL
    [
      r['id'],
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

count = db.get_first_value("SELECT COUNT(*) FROM orders")
puts "==> Database successfully populated with #{count} orders."
