update documents set license_type = case
  when subject_type = 'novel' then 'public_domain'::license_type
  when clean_text ilike '%creative commons%' then 'creative_commons'::license_type
  when coalesce(source_url,'') ilike '%gov.za%' or coalesce(source_url,'') ilike '%wcedeportal%' then 'government_educational'::license_type
  when coalesce(source_url,'') ilike '%siyavula%' or coalesce(source_url,'') ilike '%openstax%' then 'creative_commons'::license_type
  else 'educational_use'::license_type
end
where license_type is null;