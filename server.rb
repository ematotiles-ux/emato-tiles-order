#!/usr/bin/env ruby
# frozen_string_literal: true

require 'webrick'
require 'sqlite3'
require 'json'
require 'csv'
require 'date'
require 'set'
require 'cgi'
require 'fileutils'
require 'time'
require 'net/http'
require 'uri'
require 'base64'

PORT = (ENV['PORT'] || 4567).to_i
DB_PATH = ENV['DATABASE_PATH'] || File.join(__dir__, 'eod.db')
PUBLIC_DIR = File.join(__dir__, 'public')

GITHUB_REPO = ENV['GITHUB_REPO'] || 'ematotiles-ux/emato-tiles-order'
GITHUB_BRANCH = ENV['GITHUB_BACKUP_BRANCH'] || 'data-backup'
GITHUB_TOKEN = ENV['GITHUB_TOKEN']

def fetch_github_orders_json
  token = GITHUB_TOKEN || ENV['GITHUB_TOKEN']
  return nil unless token && !token.strip.empty?

  uri = URI("https://api.github.com/repos/#{GITHUB_REPO}/contents/orders.json?ref=#{GITHUB_BRANCH}")
  req = Net::HTTP::Get.new(uri)
  req['Authorization'] = "token #{token.strip}"
  req['User-Agent'] = 'EmatoTiles-App'
  req['Accept'] = 'application/vnd.github.v3+json'

  http = Net::HTTP.new(uri.host, uri.port)
  http.use_ssl = true
  http.open_timeout = 5
  http.read_timeout = 8

  res = http.request(req)
  if res.is_a?(Net::HTTPSuccess)
    data = JSON.parse(res.body)
    if data['content']
      content = Base64.decode64(data['content'])
      JSON.parse(content)
    end
  else
    puts "==> [SYNC] GitHub fetch returned #{res.code}: #{res.body.to_s[0..100]}"
    nil
  end
rescue => e
  warn "==> [SYNC] GitHub fetch warning: #{e.message}"
  nil
end

def push_orders_json_to_github(json_content, token)
  return unless token && !token.strip.empty?
  clean_token = token.strip

  # 1. Get current SHA of orders.json on data branch if it exists
  uri = URI("https://api.github.com/repos/#{GITHUB_REPO}/contents/orders.json?ref=#{GITHUB_BRANCH}")
  req = Net::HTTP::Get.new(uri)
  req['Authorization'] = "token #{clean_token}"
  req['User-Agent'] = 'EmatoTiles-App'

  http = Net::HTTP.new(uri.host, uri.port)
  http.use_ssl = true
  http.open_timeout = 5
  http.read_timeout = 10

  res = http.request(req)
  sha = nil
  if res.is_a?(Net::HTTPSuccess)
    data = JSON.parse(res.body)
    sha = data['sha']
  end

  # 2. Put updated content
  put_uri = URI("https://api.github.com/repos/#{GITHUB_REPO}/contents/orders.json")
  put_req = Net::HTTP::Put.new(put_uri)
  put_req['Authorization'] = "token #{clean_token}"
  put_req['User-Agent'] = 'EmatoTiles-App'
  put_req['Content-Type'] = 'application/json'

  payload = {
    'message' => "Auto-backup orders data [skip ci]",
    'content' => Base64.strict_encode64(json_content),
    'branch' => GITHUB_BRANCH
  }
  payload['sha'] = sha if sha

  put_req.body = JSON.generate(payload)
  put_res = http.request(put_req)
  if put_res.is_a?(Net::HTTPSuccess)
    puts "==> [SYNC] Successfully backed up orders to GitHub (#{GITHUB_BRANCH})."
  else
    warn "==> [SYNC] GitHub backup returned #{put_res.code}: #{put_res.body.to_s[0..120]}"
  end
rescue => e
  warn "==> [SYNC] Failed to push orders to GitHub: #{e.message}"
end

def sync_orders_to_json_and_github
  Thread.new do
    begin
      sleep 0.1
      db = SQLite3::Database.new(DB_PATH)
      db.results_as_hash = true
      rows = db.execute('SELECT * FROM orders ORDER BY id ASC')
      db.close

      json_file = File.join(__dir__, 'orders.json')
      json_data = JSON.pretty_generate(rows)
      File.write(json_file, json_data)

      token = GITHUB_TOKEN || ENV['GITHUB_TOKEN']
      if token && !token.strip.empty?
        push_orders_json_to_github(json_data, token)
      end
    rescue => e
      warn "==> [SYNC] Background sync warning: #{e.message}"
    end
  end
end

def ensure_database_initialized!
  FileUtils.mkdir_p(File.dirname(DB_PATH))
  db = SQLite3::Database.new(DB_PATH)
  db.results_as_hash = true

  # Check if orders table exists
  table_exists = db.get_first_value("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='orders'").to_i > 0
  unless table_exists
    puts "==> [BOOT] Initializing database schema at #{DB_PATH}..."
    schema_file = File.join(__dir__, 'schema.sql')
    if File.file?(schema_file)
      db.execute_batch(File.read(schema_file))
      puts "==> [BOOT] Schema loaded successfully."
    end
  end

  # Always check and merge latest records from GitHub data-backup branch
  puts "==> [BOOT] Checking for latest cloud backup on GitHub (#{GITHUB_BRANCH})..."
  records = fetch_github_orders_json

  # If GitHub is unavailable or empty, fall back to local orders.json only if DB is empty
  row_count = db.get_first_value("SELECT COUNT(*) FROM orders").to_i
  if (!records || !records.is_a?(Array) || records.empty?)
    if row_count.zero?
      puts "==> [BOOT] Database is empty and GitHub unavailable. Loading from local orders.json..."
      json_file = File.join(__dir__, 'orders.json')
      if File.file?(json_file)
        begin
          records = JSON.parse(File.read(json_file))
        rescue => e
          warn "==> [BOOT] Could not parse local orders.json: #{e.message}"
        end
      end
    else
      puts "==> [BOOT] GitHub unavailable; retaining #{row_count} existing database orders."
    end
  else
    puts "==> [BOOT] Found #{records.size} orders in GitHub cloud backup! Merging into database..."
  end

  if records.is_a?(Array) && !records.empty?
    db.transaction do
      records.each do |r|
        db.execute(
          <<-SQL,
          INSERT OR REPLACE INTO orders (
            id, order_no, place_date, status, party_type, manage_by, client_name, city, state,
            factory_name, size, product, finish_optional, grade,
            box_qty, box_weight, total_weight, remark, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            r['remark'] || '',
            r['created_at'] || Time.now.strftime('%Y-%m-%d %H:%M:%S'),
            r['updated_at'] || Time.now.strftime('%Y-%m-%d %H:%M:%S')
          ]
        )
      end
    end
    count = db.get_first_value("SELECT COUNT(*) FROM orders").to_i
    puts "==> [BOOT] Active database now successfully contains #{count} orders."

    # Cache to local orders.json
    json_file = File.join(__dir__, 'orders.json')
    File.write(json_file, JSON.pretty_generate(records)) rescue nil
  end
ensure
  db&.close
end

def get_db
  ensure_database_initialized! unless defined?(@db_checked) && @db_checked
  @db_checked = true
  db = SQLite3::Database.new(DB_PATH)
  db.results_as_hash = true
  db
end

def calculate_aging(place_date_str)
  begin
    pdate = Date.parse(place_date_str.to_s)
  rescue StandardError
    pdate = Date.today
  end
  days = (Date.today - pdate).to_i
  days < 0 ? 0 : days
end

def format_date_display(date_str)
  begin
    Date.parse(date_str.to_s).strftime('%d/%m/%Y')
  rescue StandardError
    date_str.to_s
  end
end

class StaticServlet < WEBrick::HTTPServlet::AbstractServlet
  MIME_TYPES = {
    '.html' => 'text/html; charset=utf-8',
    '.css'  => 'text/css; charset=utf-8',
    '.js'   => 'application/javascript; charset=utf-8',
    '.json' => 'application/json; charset=utf-8',
    '.csv'  => 'text/csv; charset=utf-8',
    '.png'  => 'image/png',
    '.jpg'  => 'image/jpeg',
    '.svg'  => 'image/svg+xml',
    '.ico'  => 'image/x-icon'
  }.freeze

  def do_GET(req, res)
    rel_path = req.path
    if rel_path == '/healthz' || rel_path == '/api/healthz'
      res.status = 200
      res['Content-Type'] = 'application/json'
      res.body = JSON.generate({ status: 'ok', app: 'emato-tiles-order-manager', time: Time.now.utc.iso8601 })
      return
    end

    rel_path = '/index.html' if rel_path.nil? || rel_path == '/' || rel_path.empty?

    clean_path = File.expand_path(File.join(PUBLIC_DIR, rel_path))
    unless clean_path.start_with?(PUBLIC_DIR)
      res.status = 403
      res.body = 'Forbidden'
      return
    end

    if File.file?(clean_path)
      ext = File.extname(clean_path).downcase
      res.status = 200
      res['Content-Type'] = MIME_TYPES[ext] || 'application/octet-stream'
      res.body = File.binread(clean_path)
    else
      res.status = 404
      res.body = "File Not Found: #{req.path}"
    end
  end
end

class APIServlet < WEBrick::HTTPServlet::AbstractServlet
  def do_OPTIONS(req, res)
    add_cors_headers(res)
    res.status = 204
  end

  def do_GET(req, res)
    add_cors_headers(res)
    path = req.path

    if path == '/api/orders'
      handle_get_orders(req, res)
    elsif path == '/api/factories'
      handle_get_factories(req, res)
    elsif path =~ %r{^/api/factories/([^/]+)/clients$}
      factory_name = URI.decode_www_form_component(Regexp.last_match(1))
      handle_get_factory_clients(factory_name, req, res)
    elsif path == '/api/stats'
      handle_get_stats(req, res)
    elsif path == '/api/export/csv'
      handle_export_csv(req, res)
    elsif path =~ %r{^/api/orders/by-order-no/([^/]+)$}
      order_no = URI.decode_www_form_component(Regexp.last_match(1))
      handle_get_order_group(order_no, req, res)
    elsif path =~ %r{^/api/orders/(\d+)$}
      id = Regexp.last_match(1).to_i
      handle_get_order_by_id(id, req, res)
    else
      render_json(res, { error: 'Not Found' }, 404)
    end
  rescue StandardError => e
    render_json(res, { error: e.message, backtrace: e.backtrace[0..3] }, 500)
  end

  def do_POST(req, res)
    add_cors_headers(res)
    if req.path == '/api/orders'
      handle_create_order(req, res)
    else
      render_json(res, { error: 'Not Found' }, 404)
    end
  rescue StandardError => e
    render_json(res, { error: e.message }, 500)
  end

  def do_PUT(req, res)
    add_cors_headers(res)
    path = req.path
    if path =~ %r{^/api/orders/by-order-no/([^/]+)/status$}
      order_no = URI.decode_www_form_component(Regexp.last_match(1))
      handle_update_order_no_status(order_no, req, res)
    elsif path =~ %r{^/api/orders/by-order-no/([^/]+)$}
      order_no = URI.decode_www_form_component(Regexp.last_match(1))
      handle_update_order_group(order_no, req, res)
    elsif path =~ %r{^/api/orders/(\d+)$}
      id = Regexp.last_match(1).to_i
      handle_update_order(id, req, res)
    else
      render_json(res, { error: 'Not Found' }, 404)
    end
  rescue StandardError => e
    render_json(res, { error: e.message }, 500)
  end

  def do_DELETE(req, res)
    add_cors_headers(res)
    path = req.path
    if path =~ %r{^/api/orders/by-order-no/([^/]+)$}
      order_no = URI.decode_www_form_component(Regexp.last_match(1))
      handle_delete_order_group(order_no, req, res)
    elsif path =~ %r{^/api/orders/(\d+)$}
      id = Regexp.last_match(1).to_i
      handle_delete_order(id, req, res)
    else
      render_json(res, { error: 'Not Found' }, 404)
    end
  rescue StandardError => e
    render_json(res, { error: e.message }, 500)
  end

  private

  def add_cors_headers(res)
    res['Access-Control-Allow-Origin'] = '*'
    res['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS'
    res['Access-Control-Allow-Headers'] = 'Content-Type, Authorization'
  end

  def render_json(res, data, status = 200)
    res.status = status
    res['Content-Type'] = 'application/json; charset=utf-8'
    res.body = JSON.generate(data)
  end

  def parse_body(req)
    JSON.parse(req.body.to_s)
  rescue StandardError
    {}
  end

  def generate_order_no(db)
    last_no = db.get_first_value("SELECT order_no FROM orders WHERE order_no LIKE 'EM-%' ORDER BY id DESC LIMIT 1")
    if last_no && last_no =~ /EM-(\d+)/
      num = Regexp.last_match(1).to_i + 1
      format('EM-%04d', num)
    else
      'EM-1001'
    end
  end

  def handle_get_orders(req, res)
    db = get_db
    query = req.query || {}

    conditions = []
    params = []

    if query['status'] && !query['status'].empty? && query['status'] != 'ALL'
      conditions << 'status = ?'
      params << query['status']
    end

    if query['party_type'] && !query['party_type'].empty? && query['party_type'] != 'ALL'
      conditions << 'party_type = ?'
      params << query['party_type']
    end

    if query['manage_by'] && !query['manage_by'].empty? && query['manage_by'] != 'ALL'
      conditions << 'manage_by = ?'
      params << query['manage_by']
    end

    if query['factory_name'] && !query['factory_name'].empty? && query['factory_name'] != 'ALL'
      conditions << 'factory_name = ?'
      params << query['factory_name']
    end

    if query['search'] && !query['search'].empty?
      term = "%#{query['search']}%"
      conditions << '(client_name LIKE ? OR city LIKE ? OR state LIKE ? OR factory_name LIKE ? OR product LIKE ? OR size LIKE ? OR manage_by LIKE ? OR order_no LIKE ?)'
      8.times { params << term }
    end

    sql = 'SELECT * FROM orders'
    sql += " WHERE #{conditions.join(' AND ')}" unless conditions.empty?

    valid_cols = %w[place_date box_qty total_weight status manage_by factory_name client_name order_no]
    sort_by = valid_cols.include?(query['sort_by']) ? query['sort_by'] : 'place_date'
    order_dir = (query['order'] && query['order'].downcase == 'asc') ? 'ASC' : 'DESC'

    # Always keep items of the same order_no strictly grouped together!
    sql += case sort_by
           when 'place_date'
             " ORDER BY MAX(place_date) OVER (PARTITION BY order_no) #{order_dir}, order_no DESC, id ASC"
           when 'order_no'
             " ORDER BY order_no #{order_dir}, id ASC"
           when 'client_name'
             " ORDER BY client_name #{order_dir}, order_no DESC, id ASC"
           when 'factory_name'
             " ORDER BY factory_name #{order_dir}, order_no DESC, id ASC"
           when 'box_qty'
             " ORDER BY SUM(box_qty) OVER (PARTITION BY order_no) #{order_dir}, order_no DESC, id ASC"
           when 'total_weight'
             " ORDER BY SUM(total_weight) OVER (PARTITION BY order_no) #{order_dir}, order_no DESC, id ASC"
           when 'status'
             " ORDER BY status #{order_dir}, order_no DESC, id ASC"
           when 'manage_by'
             " ORDER BY manage_by #{order_dir}, order_no DESC, id ASC"
           else
             " ORDER BY MAX(place_date) OVER (PARTITION BY order_no) DESC, order_no DESC, id ASC"
           end

    rows = db.execute(sql, params)

    orders = rows.map do |r|
      pdate = r['place_date']
      aging = calculate_aging(pdate)
      tot_wt = r['total_weight'].to_f

      aging_label = if aging >= 15
                      'CRITICAL'
                    elsif aging >= 7
                      'WARNING'
                    else
                      'NORMAL'
                    end

      r.merge(
        'order_day' => aging,
        'total_weight_mt' => (tot_wt / 1000.0).round(2),
        'place_date_display' => format_date_display(pdate),
        'aging_badge' => aging_label
      )
    end

    render_json(res, orders)
  ensure
    db&.close
  end

  def handle_get_factories(req, res)
    db = get_db
    rows = db.execute('SELECT * FROM orders ORDER BY factory_name ASC')

    grouped = {}
    rows.each do |r|
      fn = r['factory_name']
      grouped[fn] ||= {
        factory_name: fn,
        orders: [],
        sizes: Set.new,
        clients: Set.new,
        total_boxes: 0,
        total_weight: 0.0
      }
      grouped[fn][:orders] << r
      prod_str = (r['product'] && !r['product'].empty?) ? "#{r['size']} #{r['product']}".strip : r['size']
      grouped[fn][:sizes] << prod_str
      grouped[fn][:clients] << r['client_name']
      grouped[fn][:total_boxes] += r['box_qty'].to_i
      grouped[fn][:total_weight] += r['total_weight'].to_f
    end

    result = grouped.values.map do |f|
      order_key = ->(r) { (r['order_no'] || "EM-#{1000 + (r['id'] || 1).to_i}").to_s.strip.upcase }
      unique_orders = f[:orders].map(&order_key).uniq.size
      {
        factory_name: f[:factory_name],
        total_orders: unique_orders,
        total_entries: f[:orders].size,
        total_boxes: f[:total_boxes],
        total_tonnage: (f[:total_weight] / 1000.0).round(1),
        tile_sizes: f[:sizes].to_a.join(', '),
        clients_count: f[:clients].size
      }
    end

    render_json(res, result)
  ensure
    db&.close
  end

  def handle_get_factory_clients(factory_name, req, res)
    db = get_db
    rows = db.execute('SELECT * FROM orders WHERE factory_name = ? COLLATE NOCASE ORDER BY client_name ASC, place_date DESC', [factory_name])

    if rows.empty?
      render_json(res, { error: "No orders found for factory #{factory_name}" }, 404)
      return
    end

    client_groups = {}
    rows.each do |r|
      cname = r['client_name']
      pdate = r['place_date']
      aging = calculate_aging(pdate)
      tot_wt = r['total_weight'].to_f

      order_obj = r.merge(
        'order_day' => aging,
        'total_weight_mt' => (tot_wt / 1000.0).round(2),
        'place_date_display' => format_date_display(pdate),
        'aging_badge' => aging >= 15 ? 'CRITICAL' : (aging >= 7 ? 'WARNING' : 'NORMAL')
      )

      client_groups[cname] ||= {
        client_name: cname,
        city: r['city'],
        state: r['state'],
        total_boxes: 0,
        total_weight_kg: 0.0,
        orders: []
      }

      client_groups[cname][:total_boxes] += r['box_qty'].to_i
      client_groups[cname][:total_weight_kg] += tot_wt
      client_groups[cname][:orders] << order_obj
    end

    clients_list = client_groups.values.map do |cg|
      cg[:total_tonnage] = (cg[:total_weight_kg] / 1000.0).round(1)
      cg
    end

    total_boxes = rows.inject(0) { |sum, r| sum + r['box_qty'].to_i }
    total_wt = rows.inject(0.0) { |sum, r| sum + r['total_weight'].to_f }

    order_key = ->(r) { (r['order_no'] || "EM-#{1000 + (r['id'] || 1).to_i}").to_s.strip.upcase }
    unique_orders_count = rows.map(&order_key).uniq.size

    render_json(res, {
      factory_name: factory_name,
      total_orders: unique_orders_count,
      total_entries: rows.size,
      total_boxes: total_boxes,
      total_tonnage: (total_wt / 1000.0).round(1),
      clients_count: clients_list.size,
      clients: clients_list
    })
  ensure
    db&.close
  end

  def handle_get_order_by_id(id, req, res)
    db = get_db
    row = db.get_first_row('SELECT * FROM orders WHERE id = ?', id)
    if row
      aging = calculate_aging(row['place_date'])
      row['order_day'] = aging
      row['total_weight_mt'] = (row['total_weight'].to_f / 1000.0).round(2)
      render_json(res, row)
    else
      render_json(res, { error: 'Order not found' }, 404)
    end
  ensure
    db&.close
  end

  def handle_create_order(req, res)
    data = parse_body(req)
    db = get_db

    pdate = data['place_date'].to_s.strip
    pdate = Date.today.strftime('%Y-%m-%d') if pdate.empty?
    party_type = (data['party_type'] || 'DEALER').to_s.strip.upcase
    manage_by = (data['manage_by'] || 'UNASSIGNED').to_s.strip.upcase
    client_name = (data['client_name'] || '').to_s.strip.upcase
    city = (data['city'] || '').to_s.strip.upcase
    state = (data['state'] || '').to_s.strip.upcase
    remark = (data['remark'] || '').to_s.strip.upcase

    order_no = data['order_no'] || generate_order_no(db)

    # Multi-Factory Order: Support multiple items in single order entry!
    if data['items'] && data['items'].is_a?(Array) && !data['items'].empty?
      inserted_ids = []
      db.transaction do
        data['items'].each do |it|
          box_qty = it['box_qty'].to_i
          box_weight = it['box_weight'].to_f
          total_weight = it['total_weight'] ? it['total_weight'].to_f : (box_qty * box_weight).round(2)
          fn = (it['factory_name'] || '').to_s.strip.upcase
          size = (it['size'] || '').to_s.strip.upcase
          product = (it['product'] || '').to_s.strip.upcase
          grade = (it['grade'] || 'PRM').to_s.strip.upcase
          finish = (it['finish_optional'] || '').to_s.strip.upcase
          status = (it['status'] || 'NOT READY').to_s.strip.upcase
          it_remark = (it['remark'] && !it['remark'].empty?) ? it['remark'].to_s.strip.upcase : remark

          db.execute(
            <<-SQL,
            INSERT INTO orders (
              order_no, place_date, status, party_type, manage_by, client_name, city, state,
              factory_name, size, product, finish_optional, grade,
              box_qty, box_weight, total_weight, remark
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            SQL
            [
              order_no, pdate, status, party_type, manage_by, client_name, city, state,
              fn, size, product, finish, grade,
              box_qty, box_weight, total_weight, it_remark
            ]
          )
          inserted_ids << db.last_insert_row_id
        end
      end

      render_json(res, {
        success: true,
        order_no: order_no,
        items_count: inserted_ids.size,
        ids: inserted_ids,
        message: "Order #{order_no} created successfully with #{inserted_ids.size} factory items"
      }, 201)
    else
      # Single item entry
      box_qty = data['box_qty'].to_i
      box_weight = data['box_weight'].to_f
      total_weight = data['total_weight'] ? data['total_weight'].to_f : (box_qty * box_weight).round(2)

      db.execute(
        <<-SQL,
        INSERT INTO orders (
          order_no, place_date, status, party_type, manage_by, client_name, city, state,
          factory_name, size, product, finish_optional, grade,
          box_qty, box_weight, total_weight, remark
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        SQL
        [
          order_no, pdate, (data['status'] || 'NOT READY').to_s.strip.upcase, party_type, manage_by, client_name, city, state,
          (data['factory_name'] || '').to_s.strip.upcase,
          (data['size'] || '').to_s.strip.upcase,
          (data['product'] || '').to_s.strip.upcase,
          (data['finish_optional'] || '').to_s.strip.upcase,
          (data['grade'] || 'PRM').to_s.strip.upcase,
          box_qty, box_weight, total_weight, remark
        ]
      )
      new_id = db.last_insert_row_id
      render_json(res, { success: true, order_no: order_no, id: new_id, message: "Order #{order_no} created successfully" }, 201)
    end
  ensure
    db&.close
    sync_orders_to_json_and_github
  end

  def handle_update_order(id, req, res)
    data = parse_body(req)
    db = get_db

    existing = db.get_first_row('SELECT * FROM orders WHERE id = ?', id)
    unless existing
      render_json(res, { error: 'Order not found' }, 404)
      return
    end

    box_qty = data.key?('box_qty') ? data['box_qty'].to_i : existing['box_qty'].to_i
    box_weight = data.key?('box_weight') ? data['box_weight'].to_f : existing['box_weight'].to_f
    total_weight = data.key?('total_weight') ? data['total_weight'].to_f : (box_qty * box_weight).round(2)

    fields = {
      'order_no' => (data['order_no'] || existing['order_no']).to_s.strip.upcase,
      'place_date' => data['place_date'] || existing['place_date'],
      'status' => (data['status'] || existing['status']).to_s.strip.upcase,
      'party_type' => (data['party_type'] || existing['party_type']).to_s.strip.upcase,
      'manage_by' => (data['manage_by'] || existing['manage_by']).to_s.strip.upcase,
      'client_name' => (data['client_name'] || existing['client_name']).to_s.strip.upcase,
      'city' => (data['city'] || existing['city']).to_s.strip.upcase,
      'state' => (data['state'] || existing['state']).to_s.strip.upcase,
      'factory_name' => (data['factory_name'] || existing['factory_name']).to_s.strip.upcase,
      'size' => (data['size'] || existing['size']).to_s.strip.upcase,
      'product' => (data['product'] || existing['product']).to_s.strip.upcase,
      'finish_optional' => (data.key?('finish_optional') ? data['finish_optional'] : existing['finish_optional']).to_s.strip.upcase,
      'grade' => (data['grade'] || existing['grade']).to_s.strip.upcase,
      'box_qty' => box_qty,
      'box_weight' => box_weight,
      'total_weight' => total_weight,
      'remark' => (data.key?('remark') ? data['remark'] : existing['remark']).to_s.strip.upcase,
      'updated_at' => Time.now.strftime('%Y-%m-%d %H:%M:%S')
    }

    set_clause = fields.keys.map { |k| "#{k} = ?" }.join(', ')
    db.execute("UPDATE orders SET #{set_clause} WHERE id = ?", [*fields.values, id])

    updated = db.get_first_row('SELECT * FROM orders WHERE id = ?', id)
    render_json(res, { success: true, order: updated })
  ensure
    db&.close
    sync_orders_to_json_and_github
  end

  def handle_delete_order(id, req, res)
    db = get_db
    db.execute('DELETE FROM orders WHERE id = ?', id)
    render_json(res, { success: true, message: "Order #{id} deleted successfully" })
  ensure
    db&.close
    sync_orders_to_json_and_github
  end

  def handle_get_order_group(order_no, req, res)
    db = get_db
    rows = db.execute('SELECT * FROM orders WHERE UPPER(order_no) = UPPER(?) ORDER BY id ASC', order_no)
    if rows.empty?
      render_json(res, { error: 'Order not found' }, 404)
      return
    end

    first = rows.first
    items = rows.map do |r|
      pdate = r['place_date']
      aging = calculate_aging(pdate)
      tot_wt = r['total_weight'].to_f
      r.merge(
        'order_day' => aging,
        'total_weight_mt' => (tot_wt / 1000.0).round(2),
        'place_date_display' => format_date_display(pdate)
      )
    end

    render_json(res, {
      order_no: first['order_no'],
      client_name: first['client_name'],
      city: first['city'],
      state: first['state'],
      place_date: first['place_date'],
      party_type: first['party_type'],
      manage_by: first['manage_by'],
      remark: first['remark'],
      items: items
    })
  ensure
    db&.close
  end

  def handle_update_order_group(order_no, req, res)
    data = parse_body(req)
    db = get_db

    pdate = data['place_date'].to_s.strip
    pdate = Date.today.strftime('%Y-%m-%d') if pdate.empty?
    party_type = (data['party_type'] || 'DEALER').to_s.strip.upcase
    manage_by = (data['manage_by'] || 'UNASSIGNED').to_s.strip.upcase
    client_name = (data['client_name'] || '').to_s.strip.upcase
    city = (data['city'] || '').to_s.strip.upcase
    state = (data['state'] || '').to_s.strip.upcase
    remark = (data['remark'] || '').to_s.strip.upcase
    target_order_no = (data['order_no'] || order_no).to_s.strip.upcase

    items = data['items'] || []
    unless items.is_a?(Array) && !items.empty?
      render_json(res, { error: 'Order must contain at least one item' }, 400)
      return
    end

    db.transaction do
      existing_rows = db.execute('SELECT id FROM orders WHERE UPPER(order_no) = UPPER(?)', order_no)
      existing_ids = existing_rows.map { |r| r['id'] }
      submitted_ids = []

      items.each do |it|
        item_id = it['id'] ? it['id'].to_i : nil
        box_qty = it['box_qty'].to_i
        box_weight = it['box_weight'].to_f
        total_weight = it['total_weight'] ? it['total_weight'].to_f : (box_qty * box_weight).round(2)
        fn = (it['factory_name'] || '').to_s.strip.upcase
        size = (it['size'] || '').to_s.strip.upcase
        product = (it['product'] || '').to_s.strip.upcase
        grade = (it['grade'] || 'PRM').to_s.strip.upcase
        finish = (it['finish_optional'] || '').to_s.strip.upcase
        status = (it['status'] || 'NOT READY').to_s.strip.upcase
        it_remark = (it['remark'] && !it['remark'].empty?) ? it['remark'].to_s.strip.upcase : remark

        if item_id && existing_ids.include?(item_id)
          db.execute(
            <<-SQL,
            UPDATE orders SET
              order_no = ?, place_date = ?, status = ?, party_type = ?, manage_by = ?,
              client_name = ?, city = ?, state = ?, factory_name = ?, size = ?,
              product = ?, finish_optional = ?, grade = ?, box_qty = ?, box_weight = ?,
              total_weight = ?, remark = ?, updated_at = ?
            WHERE id = ?
            SQL
            [
              target_order_no, pdate, status, party_type, manage_by,
              client_name, city, state, fn, size,
              product, finish, grade, box_qty, box_weight,
              total_weight, it_remark, Time.now.strftime('%Y-%m-%d %H:%M:%S'),
              item_id
            ]
          )
          submitted_ids << item_id
        else
          db.execute(
            <<-SQL,
            INSERT INTO orders (
              order_no, place_date, status, party_type, manage_by, client_name, city, state,
              factory_name, size, product, finish_optional, grade,
              box_qty, box_weight, total_weight, remark
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            SQL
            [
              target_order_no, pdate, status, party_type, manage_by, client_name, city, state,
              fn, size, product, finish, grade,
              box_qty, box_weight, total_weight, it_remark
            ]
          )
          submitted_ids << db.last_insert_row_id
        end
      end

      # Delete rows that the user explicitly removed in the edit modal
      removed_ids = existing_ids - submitted_ids
      unless removed_ids.empty?
        placeholders = removed_ids.map { '?' }.join(', ')
        db.execute("DELETE FROM orders WHERE id IN (#{placeholders})", removed_ids)
      end
    end

    render_json(res, {
      success: true,
      order_no: target_order_no,
      items_count: items.size,
      message: "Order #{target_order_no} updated successfully with #{items.size} factory items"
    })
  ensure
    db&.close
    sync_orders_to_json_and_github
  end

  def handle_delete_order_group(order_no, req, res)
    db = get_db
    db.execute('DELETE FROM orders WHERE UPPER(order_no) = UPPER(?)', order_no)
    render_json(res, { success: true, message: "Order #{order_no} deleted successfully" })
  ensure
    db&.close
    sync_orders_to_json_and_github
  end

  def handle_update_order_no_status(order_no, req, res)
    data = parse_body(req)
    new_status = data['status'].to_s.strip.upcase
    db = get_db

    rows = db.execute('SELECT id FROM orders WHERE UPPER(order_no) = UPPER(?)', order_no)
    if rows.empty?
      render_json(res, { error: 'Order not found' }, 404)
      return
    end

    db.execute('UPDATE orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE UPPER(order_no) = UPPER(?)', [new_status, order_no])
    render_json(res, {
      success: true,
      order_no: order_no,
      status: new_status,
      items_updated: rows.size,
      message: "Order #{order_no} (#{rows.size} items) status changed to #{new_status}"
    })
  ensure
    db&.close
    sync_orders_to_json_and_github
  end

  def handle_get_stats(req, res)
    db = get_db

    rows = db.execute('SELECT * FROM orders')
    active_rows = rows.reject { |r| r['status'] == 'DISPATCHED' || r['status'] == 'BILLED DONE' }

    order_key = ->(r) { (r['order_no'] || "EM-#{1000 + (r['id'] || 1).to_i}").to_s.strip.upcase }

    active_order_nos = active_rows.map(&order_key).uniq
    all_order_nos = rows.map(&order_key).uniq

    total_orders = active_order_nos.size
    total_entries = active_rows.size
    all_orders_count = all_order_nos.size
    all_entries_count = rows.size

    ready_orders = rows.select { |r| r['status'] == 'READY' }.map(&order_key).uniq.size
    pending_orders = active_rows.select { |r| r['status'] == 'NOT READY' }.map(&order_key).uniq.size
    dispatched_orders = rows.select { |r| r['status'] == 'DISPATCHED' }.map(&order_key).uniq.size
    billed_orders = rows.select { |r| r['status'] == 'BILLED DONE' }.map(&order_key).uniq.size

    total_boxes = active_rows.inject(0) { |sum, r| sum + r['box_qty'].to_i }
    ready_boxes = rows.select { |r| r['status'] == 'READY' }.inject(0) { |sum, r| sum + r['box_qty'].to_i }

    total_weight = active_rows.inject(0.0) { |sum, r| sum + r['total_weight'].to_f }
    ready_weight = rows.select { |r| r['status'] == 'READY' }.inject(0.0) { |sum, r| sum + r['total_weight'].to_f }
    pending_weight = rows.select { |r| r['status'] == 'NOT READY' }.inject(0.0) { |sum, r| sum + r['total_weight'].to_f }

    critical_aging = active_rows.select { |r| calculate_aging(r['place_date']) >= 15 }.map(&order_key).uniq.size

    dealer_count = active_rows.select { |r| r['party_type'] == 'DEALER' }.map(&order_key).uniq.size
    project_count = active_rows.select { |r| r['party_type'] == 'PROJECT' }.map(&order_key).uniq.size
    depo_count = active_rows.select { |r| r['party_type'] == 'DEPO ORDER' }.map(&order_key).uniq.size

    stats = {
      total_orders: total_orders,
      total_entries: total_entries,
      all_orders_count: all_orders_count,
      all_entries_count: all_entries_count,
      ready_orders: ready_orders,
      pending_orders: pending_orders,
      dispatched_orders: dispatched_orders,
      billed_orders: billed_orders,
      total_boxes: total_boxes,
      ready_boxes: ready_boxes,
      total_weight_kg: total_weight.round(1),
      total_weight_mt: (total_weight / 1000.0).round(2),
      ready_weight_mt: (ready_weight / 1000.0).round(2),
      pending_weight_mt: (pending_weight / 1000.0).round(2),
      est_trucks_ready: (ready_weight / 26000.0).round(1),
      critical_aging_count: critical_aging,
      dealer_count: dealer_count,
      project_count: project_count,
      depo_count: depo_count
    }

    render_json(res, stats)
  ensure
    db&.close
  end

  def handle_export_csv(req, res)
    db = get_db
    rows = db.execute('SELECT * FROM orders ORDER BY MAX(place_date) OVER (PARTITION BY order_no) DESC, order_no DESC, id ASC')

    csv_data = CSV.generate(headers: true) do |csv|
      csv << [
        'ORDER NO', 'PLACE DATE', 'ORDER DAYS', 'STATUS', 'PARTY TYPE', 'MANAGE BY', 'PARTY NAME',
        'CENTER', 'STATE', 'FECTORY NAME', 'SIZE', 'PRODUCT',
        'FINISH-OPTIONAL', 'GRADE', 'BOX QTY', 'BOX WEIGHT', 'TOTAL WEIGHT', 'REMARK'
      ]

      rows.each do |r|
        aging = calculate_aging(r['place_date'])
        pdate_fmt = format_date_display(r['place_date'])
        csv << [
          r['order_no'],
          pdate_fmt,
          aging,
          r['status'],
          r['party_type'],
          r['manage_by'],
          r['client_name'],
          r['city'],
          r['state'],
          r['factory_name'],
          r['size'],
          r['product'],
          r['finish_optional'],
          r['grade'],
          r['box_qty'],
          r['box_weight'],
          r['total_weight'],
          r['remark']
        ]
      end
    end

    res.status = 200
    res['Content-Type'] = 'text/csv; charset=utf-8'
    res['Content-Disposition'] = "attachment; filename=\"Emato_Orders_#{Date.today}.csv\""
    res.body = csv_data
  ensure
    db&.close
  end
end

class SlipServlet < WEBrick::HTTPServlet::AbstractServlet
  def do_GET(req, res)
    query = req.query || {}
    db = get_db

    id = query['id']
    order_no = query['order_no']
    client = query['client']
    factory = query['factory']
    ready_only = query['ready_only'] == '1' || query['ready_only'] == 'true'

    orders = []
    if id && !id.empty?
      row = db.get_first_row('SELECT * FROM orders WHERE id = ?', id.to_i)
      orders << row if row
    elsif order_no && !order_no.empty?
      sql = 'SELECT * FROM orders WHERE order_no = ?'
      sql += " AND status = 'READY'" if ready_only
      sql += ' ORDER BY id ASC'
      orders = db.execute(sql, order_no)
      if orders.empty? && ready_only
        orders = db.execute('SELECT * FROM orders WHERE order_no = ? ORDER BY id ASC', order_no)
      end
    elsif client && !client.empty? && factory && !factory.empty?
      sql = 'SELECT * FROM orders WHERE UPPER(client_name) = UPPER(?) AND UPPER(factory_name) = UPPER(?)'
      sql += " AND status = 'READY'" if ready_only
      sql += ' ORDER BY id ASC'
      orders = db.execute(sql, [client, factory])
      if orders.empty? && ready_only
        orders = db.execute('SELECT * FROM orders WHERE UPPER(client_name) = UPPER(?) AND UPPER(factory_name) = UPPER(?) ORDER BY id ASC', [client, factory])
      end
    elsif client && !client.empty?
      sql = 'SELECT * FROM orders WHERE UPPER(client_name) = UPPER(?)'
      sql += " AND status = 'READY'" if ready_only
      sql += ' ORDER BY id ASC'
      orders = db.execute(sql, client)
      if orders.empty? && ready_only
        orders = db.execute('SELECT * FROM orders WHERE UPPER(client_name) = UPPER(?) ORDER BY id ASC', client)
      end
    else
      orders = db.execute("SELECT * FROM orders WHERE status = 'READY' ORDER BY id DESC LIMIT 50")
      orders = db.execute("SELECT * FROM orders ORDER BY id DESC LIMIT 50") if orders.empty?
    end

    res.status = 200
    res['Content-Type'] = 'text/html; charset=utf-8'
    res.body = generate_slip_html(orders, query, req)
  rescue StandardError => e
    res.status = 500
    res['Content-Type'] = 'text/html; charset=utf-8'
    res.body = "<h1>Error generating loading slip</h1><p>#{CGI.escapeHTML(e.message)}</p>"
  ensure
    db&.close
  end

  private

  def generate_slip_html(orders, query, req)
    if orders.empty?
      return <<-HTML
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Loading Slip - emato® TILES</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Inter', sans-serif; background: #f8fafc; color: #0f172a; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; }
    .card { background: white; border: 1px solid #e2e8f0; border-radius: 12px; padding: 36px; max-width: 500px; text-align: center; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); }
    h2 { font-size: 1.25rem; font-weight: 800; color: #0f172a; margin-top: 14px; }
    p { color: #64748b; font-size: 0.9rem; line-height: 1.5; }
    .btn { display: inline-block; background: #0284c7; color: white; text-decoration: none; padding: 10px 20px; border-radius: 8px; font-weight: 700; font-size: 0.85rem; margin-top: 18px; }
  </style>
</head>
<body>
  <div class="card">
    <div style="font-size: 3rem;">📋</div>
    <h2>No Ready Orders Found</h2>
    <p>No matching orders marked as <strong>READY</strong> were found for the selected client or factory.</p>
    <a href="/" class="btn">← Back to Dashboard</a>
  </div>
</body>
</html>
      HTML
    end

    first = orders.first
    client_name = first['client_name'] || 'DIRECT CLIENT'
    city = first['city'] || ''
    state = first['state'] || ''
    manage_by = first['manage_by'] || 'DISPATCH DESK'
    factories = orders.map { |o| o['factory_name'] }.compact.uniq.join(', ')
    order_nos = orders.map { |o| o['order_no'] }.compact.uniq.join(', ')
    slip_no = "LS-EM-#{first['order_no'] || '1001'}-#{Date.today.strftime('%d%m%y')}"
    slip_date = Date.today.strftime('%d/%m/%Y')

    total_boxes = orders.inject(0) { |s, o| s + o['box_qty'].to_i }
    total_wt = orders.inject(0.0) { |s, o| s + o['total_weight'].to_f }
    total_mt = (total_wt / 1000.0).round(2)

    rows_html = orders.map.with_index(1) do |o, idx|
      is_ready = o['status'] == 'READY'
      status_badge = is_ready ? '<span class="status-badge ready">✓ READY TO LOAD</span>' : %Q(<span class="status-badge pending">#{CGI.escapeHTML(o['status'].to_s)}</span>)
      box_wt = o['box_weight'].to_f.round(1)
      tot_wt = o['total_weight'].to_f.round(1)
      mt_val = (tot_wt / 1000.0).round(2)

      <<-TR
        <tr>
          <td class="text-center">#{idx}</td>
          <td><strong style="color:#0369a1;">#{CGI.escapeHTML(o['factory_name'].to_s)}</strong></td>
          <td><strong>#{CGI.escapeHTML(o['size'].to_s)}</strong></td>
          <td>#{CGI.escapeHTML(o['product'].to_s)}</td>
          <td class="text-center"><span class="grade-pill">#{CGI.escapeHTML(o['grade'].to_s)}</span></td>
          <td class="text-center">#{status_badge}</td>
          <td class="text-right font-mono font-bold">#{o['box_qty'].to_i}</td>
          <td class="text-right font-mono">#{box_wt} kg</td>
          <td class="text-right font-mono font-bold" style="color:#0f172a;">#{tot_wt} kg</td>
          <td class="text-right font-mono font-bold" style="color:#0284c7;">#{mt_val} MT</td>
        </tr>
      TR
    end.join("\n")

    auto_print_script = (query['print'] == '1') ? '<script>window.addEventListener("load", () => window.print());</script>' : ''

    <<-HTML
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Loading Advice Slip - #{CGI.escapeHTML(client_name)} - emato® TILES</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@600;700;800&display=swap" rel="stylesheet">
  <script src="/html2pdf.bundle.min.js"></script>
  <style>
    :root {
      --primary: #0284c7;
      --primary-dark: #0369a1;
      --text-main: #0f172a;
      --text-muted: #64748b;
      --border: #cbd5e1;
      --bg-page: #f1f5f9;
      --green: #10b981;
      --green-dark: #047857;
      --green-light: #ecfdf5;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      background-color: var(--bg-page);
      color: var(--text-main);
      padding: 24px 12px 60px 12px;
      -webkit-font-smoothing: antialiased;
    }

    /* Top Action Bar (Hidden on Print / PDF) */
    .action-bar {
      max-width: 860px;
      margin: 0 auto 20px auto;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 12px;
      background: white;
      padding: 12px 18px;
      border-radius: 12px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.06);
      border: 1px solid #e2e8f0;
    }

    .btn-action {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 8px 16px;
      border-radius: 8px;
      font-size: 0.84rem;
      font-weight: 700;
      cursor: pointer;
      text-decoration: none;
      border: none;
      transition: all 0.15s ease;
    }

    .btn-wa { background: #25d366; color: white; }
    .btn-wa:hover { background: #1eb956; }
    .btn-pdf { background: #0284c7; color: white; }
    .btn-pdf:hover { background: #0369a1; }
    .btn-print { background: #334155; color: white; }
    .btn-print:hover { background: #1e293b; }
    .btn-back { background: #f1f5f9; color: #475569; }
    .btn-back:hover { background: #e2e8f0; }

    /* Main Loading Slip Paper Sheet */
    .slip-container {
      max-width: 860px;
      margin: 0 auto;
      background: white;
      border: 2px solid #0f172a;
      border-radius: 4px;
      padding: 32px 36px;
      box-shadow: 0 10px 25px -5px rgba(0,0,0,0.1);
      position: relative;
    }

    /* Header */
    .slip-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 2px solid #0f172a;
      padding-bottom: 16px;
      margin-bottom: 20px;
    }

    .brand-section {
      display: flex;
      align-items: center;
      gap: 14px;
    }

    .brand-logo {
      height: 46px;
      object-fit: contain;
    }

    .brand-text h1 {
      font-size: 1.45rem;
      font-weight: 900;
      color: #0f172a;
      letter-spacing: -0.02em;
      line-height: 1.1;
    }

    .brand-text .sub {
      font-size: 0.76rem;
      font-weight: 800;
      color: var(--primary);
      letter-spacing: 0.08em;
      text-transform: uppercase;
      margin-top: 2px;
    }

    .doc-badge-wrap {
      text-align: right;
    }

    .doc-title {
      font-size: 1.15rem;
      font-weight: 900;
      letter-spacing: 0.04em;
      color: #0f172a;
      text-transform: uppercase;
    }

    .doc-status-pill {
      display: inline-block;
      background: #10b981;
      color: white;
      font-weight: 800;
      font-size: 0.74rem;
      padding: 4px 10px;
      border-radius: 20px;
      letter-spacing: 0.04em;
      margin-top: 4px;
      text-transform: uppercase;
    }

    /* Meta Grid */
    .meta-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 12px 24px;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 14px 18px;
      margin-bottom: 20px;
    }

    .meta-item {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .meta-label {
      font-size: 0.68rem;
      font-weight: 800;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .meta-val {
      font-size: 0.95rem;
      font-weight: 800;
      color: #0f172a;
    }

    .meta-val.highlight-factory {
      color: #0284c7;
      font-size: 1.05rem;
    }

    /* Items Table */
    .slip-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 20px;
      font-size: 0.8rem;
    }

    .slip-table th {
      background-color: #0f172a;
      color: white;
      padding: 8px 10px;
      font-size: 0.7rem;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      border: 1px solid #0f172a;
    }

    .slip-table td {
      padding: 8px 10px;
      border: 1px solid #cbd5e1;
      vertical-align: middle;
    }

    .slip-table tr:nth-child(even) td {
      background-color: #f8fafc;
    }

    .slip-table tfoot td {
      background-color: #e2e8f0;
      font-weight: 900;
      border-top: 2px solid #0f172a;
      border-bottom: 2px solid #0f172a;
    }

    .font-mono { font-family: 'JetBrains Mono', monospace; }
    .font-bold { font-weight: 800; }
    .text-center { text-align: center; }
    .text-right { text-align: right; }

    .grade-pill {
      font-size: 0.68rem;
      font-weight: 800;
      background: #f1f5f9;
      border: 1px solid #cbd5e1;
      padding: 2px 6px;
      border-radius: 4px;
    }

    .status-badge {
      display: inline-block;
      padding: 3px 8px;
      border-radius: 4px;
      font-size: 0.68rem;
      font-weight: 800;
      text-transform: uppercase;
    }

    .status-badge.ready {
      background: #ecfdf5;
      color: #047857;
      border: 1px solid #a7f3d0;
    }

    .status-badge.pending {
      background: #fffbeb;
      color: #b45309;
      border: 1px solid #fde68a;
    }

    /* Summary Bar */
    .summary-card {
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: #0f172a;
      color: white;
      border-radius: 6px;
      padding: 12px 18px;
      margin-bottom: 20px;
    }

    .sum-title {
      font-size: 0.8rem;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .sum-metrics {
      display: flex;
      gap: 20px;
      align-items: center;
    }

    .metric-badge {
      text-align: right;
    }

    .metric-lbl {
      font-size: 0.64rem;
      color: #94a3b8;
      text-transform: uppercase;
      font-weight: 700;
    }

    .metric-val {
      font-family: 'JetBrains Mono', monospace;
      font-size: 1.15rem;
      font-weight: 900;
      color: #38bdf8;
    }

    /* Instructions Notice */
    .notice-box {
      border: 1px dashed #0284c7;
      background: #f0f9ff;
      border-radius: 6px;
      padding: 12px 14px;
      margin-bottom: 24px;
      font-size: 0.74rem;
      color: #0369a1;
      line-height: 1.5;
    }

    .notice-box strong {
      color: #0f172a;
      font-weight: 800;
    }

    /* Signatures Section */
    .signatures-section {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 20px;
      margin-top: 30px;
      padding-top: 20px;
      border-top: 1px solid #cbd5e1;
    }

    .sig-box {
      text-align: center;
    }

    .sig-line {
      border-bottom: 1px solid #0f172a;
      height: 36px;
      margin-bottom: 6px;
    }

    .sig-label {
      font-size: 0.7rem;
      font-weight: 800;
      color: #475569;
      text-transform: uppercase;
    }

    /* Print Styles */
    @media print {
      body { background: white !important; padding: 0 !important; }
      .action-bar { display: none !important; }
      .slip-container {
        border: none !important;
        box-shadow: none !important;
        padding: 0 !important;
        max-width: 100% !important;
      }
      @page { size: A4 portrait; margin: 12mm; }
    }
  </style>
</head>
<body>

  <!-- Top Action Bar -->
  <div class="action-bar">
    <div style="display:flex; align-items:center; gap:8px;">
      <a href="/" class="btn-action btn-back">← Dashboard</a>
      <span style="font-size:0.8rem; font-weight:700; color:#64748b;">Loading Slip Ref: <strong style="color:#0f172a;">#{slip_no}</strong></span>
    </div>
    <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
      <button class="btn-action btn-wa" onclick="shareWhatsApp()">📲 Send on WhatsApp</button>
      <button class="btn-action btn-pdf" onclick="downloadPdf()">📥 Download PDF File</button>
      <button class="btn-action btn-print" onclick="window.print()">🖨️ Print Slip</button>
    </div>
  </div>

  <!-- Main Slip Sheet -->
  <div class="slip-container" id="slipDocument">
    <!-- Slip Header -->
    <div class="slip-header">
      <div class="brand-section">
        <img src="/logo.png" alt="emato TILES" class="brand-logo" onerror="this.style.display='none'">
        <div class="brand-text">
          <h1>emato® TILES</h1>
          <div class="sub">Ceramic Dispatch & Vehicle Loading Clearance</div>
        </div>
      </div>
      <div class="doc-badge-wrap">
        <div class="doc-title">LOADING ADVICE SLIP</div>
        <div class="doc-status-pill">● READY FOR LOADING</div>
      </div>
    </div>

    <!-- Meta Details Grid -->
    <div class="meta-grid">
      <div class="meta-item">
        <span class="meta-label">Slip Advice No:</span>
        <span class="meta-val font-mono">#{slip_no}</span>
      </div>
      <div class="meta-item">
        <span class="meta-label">Date of Issue:</span>
        <span class="meta-val font-mono">#{slip_date}</span>
      </div>
      <div class="meta-item">
        <span class="meta-label">Client / Party Name:</span>
        <span class="meta-val">#{CGI.escapeHTML(client_name)}</span>
      </div>
      <div class="meta-item">
        <span class="meta-label">Destination Station:</span>
        <span class="meta-val">#{CGI.escapeHTML(city)}#{state.empty? ? '' : ', ' + CGI.escapeHTML(state)}</span>
      </div>
      <div class="meta-item">
        <span class="meta-label">Manufacturing Plant / Company:</span>
        <span class="meta-val highlight-factory">🏭 #{CGI.escapeHTML(factories)}</span>
      </div>
      <div class="meta-item">
        <span class="meta-label">Order Reference / Managed By:</span>
        <span class="meta-val">#{CGI.escapeHTML(order_nos)} (#{CGI.escapeHTML(manage_by)})</span>
      </div>
    </div>

    <!-- Items Table -->
    <table class="slip-table">
      <thead>
        <tr>
          <th width="32" class="text-center">#</th>
          <th>Plant / Factory</th>
          <th>Size</th>
          <th>Product / Finish</th>
          <th width="48" class="text-center">Grade</th>
          <th width="105" class="text-center">Status</th>
          <th width="75" class="text-right">Boxes</th>
          <th width="75" class="text-right">Box Wt</th>
          <th width="90" class="text-right">Total Wt</th>
          <th width="75" class="text-right">Tonnage</th>
        </tr>
      </thead>
      <tbody>
        #{rows_html}
      </tbody>
      <tfoot>
        <tr>
          <td colspan="6" style="text-align:right; font-weight:800; text-transform:uppercase;">Grand Total Verified Ready:</td>
          <td class="text-right font-mono font-bold">#{total_boxes.to_s}</td>
          <td></td>
          <td class="text-right font-mono font-bold">#{total_wt.round(1)} kg</td>
          <td class="text-right font-mono font-bold" style="color:#0284c7;">#{total_mt} MT</td>
        </tr>
      </tfoot>
    </table>

    <!-- Summary Box -->
    <div class="summary-card">
      <div>
        <div class="sum-title">🚚 VEHICLE LOADING AUTHORIZATION</div>
        <div style="font-size:0.72rem; color:#94a3b8; margin-top:2px;">Material ready for immediate vehicle loading at Morbi Ceramic Cluster</div>
      </div>
      <div class="sum-metrics">
        <div class="metric-badge">
          <div class="metric-lbl">Total Boxes</div>
          <div class="metric-val">#{total_boxes}</div>
        </div>
        <div class="metric-badge">
          <div class="metric-lbl">Gross Weight</div>
          <div class="metric-val">#{total_mt} MT</div>
        </div>
      </div>
    </div>

    <!-- Notice -->
    <div class="notice-box">
      <strong>DISPATCH & VEHICLE LOADING TERMS:</strong><br>
      1. <strong>Plant Verification:</strong> The listed ceramic tiles are inspected, palletized, and ready for loading at <strong>#{CGI.escapeHTML(factories)}</strong>.<br>
      2. <strong>Driver Presentation:</strong> The transporter / vehicle driver must present this slip (digital copy or print) at the factory loading dock for clearance.<br>
      3. <strong>Quality Check:</strong> Please inspect carton seal and batch shade alignment prior to gate exit.
    </div>

    <!-- Signatures -->
    <div class="signatures-section">
      <div class="sig-box">
        <div class="sig-line"></div>
        <div class="sig-label">Authorized Dispatch Officer<br><strong>emato® TILES MORBI</strong></div>
      </div>
      <div class="sig-box">
        <div class="sig-line"></div>
        <div class="sig-label">Factory Warehouse Officer<br><strong>#{CGI.escapeHTML(factories)}</strong></div>
      </div>
      <div class="sig-box">
        <div class="sig-line"></div>
        <div class="sig-label">Transporter / Driver Signature<br>Vehicle No: _________________</div>
      </div>
    </div>
  </div>

  <script>
    function downloadPdf() {
      const element = document.getElementById('slipDocument');
      const filename = 'READY_TO_LOAD_#{client_name.gsub(/[^a-zA-Z0-9_-]/, '_')}_#{factories.gsub(/[^a-zA-Z0-9_-]/, '_')}.pdf';
      const opt = {
        margin: [8, 8, 8, 8],
        filename: filename,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, letterRendering: true },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
      };
      html2pdf().set(opt).from(element).save();
    }

    function shareWhatsApp() {
      const text = encodeURIComponent(
        "🚚 *emato® TILES - ORDER READY TO LOAD* 🚚\\n\\n" +
        "Dear *#{client_name}*,\\n" +
        "Your ceramic tiles order is *READY TO LOAD* at *#{factories}*!\\n\\n" +
        "📋 *DISPATCH DETAILS:*\\n" +
        "• *Company / Plant:* #{factories}\\n" +
        "• *Order Ref:* #{order_nos}\\n" +
        "• *Destination:* #{city}#{state.empty? ? '' : ', ' + state}\\n" +
        "• *Quantity:* #{total_boxes} Boxes (#{total_mt} MT)\\n" +
        "• *Status:* 🟢 READY FOR IMMEDIATE LOADING\\n\\n" +
        "📄 *Official Loading Slip PDF:*\\n" +
        window.location.href + "\\n\\n" +
        "Kindly arrange vehicle placement / loading clearance.\\n" +
        "Thank you,\\n*emato® TILES Morbi*"
      );
      window.open('https://api.whatsapp.com/send?text=' + text, '_blank');
    }

    if (new URLSearchParams(window.location.search).get('download') === '1' || window.location.pathname.endsWith('.pdf')) {
      window.addEventListener('DOMContentLoaded', () => {
        setTimeout(downloadPdf, 600);
      });
    }
  </script>
  #{auto_print_script}
</body>
</html>
    HTML
  end
end

if __FILE__ == $PROGRAM_NAME
  ensure_database_initialized!
  FileUtils.mkdir_p(PUBLIC_DIR)
  server = WEBrick::HTTPServer.new(
    Port: PORT,
    BindAddress: '0.0.0.0',
    Logger: WEBrick::Log.new($stderr, WEBrick::Log::INFO),
    AccessLog: []
  )

  server.mount('/api', APIServlet)
  server.mount('/slip', SlipServlet)
  server.mount('/', StaticServlet)

  trap('INT') { server.shutdown }
  trap('TERM') { server.shutdown }

  # Keep-Alive Background Thread: Prevents Render free tier idle spin-down
  Thread.new do
    target_url = ENV['RENDER_EXTERNAL_URL'] || 'https://emato-tiles-orders.onrender.com'
    puts "==> [KEEP-ALIVE] Auto-pinger initialized for #{target_url}/healthz (pings every 9 mins)"
    loop do
      sleep 540 # 9 minutes (well within Render's 15-minute idle limit)
      begin
        uri = URI("#{target_url}/healthz")
        res = Net::HTTP.get_response(uri)
        puts "==> [KEEP-ALIVE] Health ping to #{uri} returned #{res.code} (maintaining 24/7 container uptime)"
      rescue => e
        warn "==> [KEEP-ALIVE] Health ping notice: #{e.message}"
      end
    end
  end

  puts "=========================================================="
  puts "  emato TILES Order Manager v2.0 running on port #{PORT}"
  puts "  URL: http://localhost:#{PORT}"
  puts "=========================================================="

  server.start
end

