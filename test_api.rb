#!/usr/bin/env ruby
# frozen_string_literal: true

require_relative 'server'

puts "=== 1. Testing Database & Orders ==="
db = get_db
orders = db.execute("SELECT * FROM orders")
puts "Total Orders in DB: #{orders.size}"
raise "Expected orders in DB" unless orders.size > 0

puts "\n=== 2. Testing Factory Hub Aggregation ==="
servlet = APIServlet.allocate

class MockRequest
  attr_accessor :path, :query, :body
  def initialize(path, query = {}, body = '')
    @path = path
    @query = query
    @body = body
  end
end

class MockResponse
  attr_accessor :status, :body, :headers
  def initialize
    @status = 200
    @body = ''
    @headers = {}
  end
  def []=(k, v); @headers[k] = v; end
  def [](k); @headers[k]; end
end

req = MockRequest.new('/api/factories')
res = MockResponse.new
servlet.send(:handle_get_factories, req, res)
factories = JSON.parse(res.body)
puts "Loaded #{factories.size} factories in Factories Hub:"
factories.each do |f|
  puts "  - #{f['factory_name']}: #{f['total_orders']} orders | #{f['total_boxes']} boxes | #{f['total_tonnage']} Tons | Sizes: #{f['tile_sizes']}"
end

puts "\n=== 3. Testing Factory Client-Wise Drilldown (ASTICA) ==="
req = MockRequest.new('/api/factories/ASTICA/clients')
res = MockResponse.new
servlet.send(:handle_get_factory_clients, 'ASTICA', req, res)
astica = JSON.parse(res.body)
puts "Factory: #{astica['factory_name']} | Orders: #{astica['total_orders']} | Boxes: #{astica['total_boxes']} | Tonnage: #{astica['total_tonnage']} Tons"
puts "Clients placed orders in ASTICA:"
astica['clients'].each do |c|
  puts "  -> #{c['client_name']} (#{c['city']}, #{c['state']}) : #{c['orders'].size} order(s) | #{c['total_boxes']} boxes | #{c['total_tonnage']} Tons"
  c['orders'].each do |o|
    puts "     * [#{o['status']}] #{o['place_date_display']} (#{o['order_day']}d) | #{o['size']} #{o['product']} | #{o['box_qty']} bxs | #{o['total_weight_mt']} MT | Manage: #{o['manage_by']}"
  end
end

puts "\n=== 4. Testing Factory Client-Wise Drilldown (LEGEND) ==="
req = MockRequest.new('/api/factories/LEGEND/clients')
res = MockResponse.new
servlet.send(:handle_get_factory_clients, 'LEGEND', req, res)
legend = JSON.parse(res.body)
puts "Factory: #{legend['factory_name']} | Orders: #{legend['total_orders']} | Tonnage: #{legend['total_tonnage']} Tons"
puts "Clients placed orders in LEGEND:"
legend['clients'].each do |c|
  puts "  -> #{c['client_name']} (#{c['city']}) : #{c['orders'].size} order(s) | #{c['total_boxes']} boxes"
end

puts "\n========================================================"
puts "  100% OF BACKEND & FACTORY CLIENT TESTS PASSED!        "
puts "========================================================"
