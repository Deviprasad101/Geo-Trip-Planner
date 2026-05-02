import csv
import random

descriptions = {
    'Food Place': [
        'Experience authentic local flavors with a perfect blend of spices. This establishment is known for its hygienic preparation and warm hospitality, making it a favorite among both locals and tourists. The ambiance perfectly complements the traditional dining experience.',
        'Savor mouth-watering delicacies prepared by expert chefs using generations-old recipes. Whether you are looking for a quick bite or a lavish meal, this place offers an unforgettable culinary journey. Highly recommended for food lovers visiting Tirupati.',
        'A beloved dining destination offering a wide variety of fresh and delicious meals. The serene atmosphere and prompt service ensure a delightful experience. Perfect for family dinners or a relaxing meal after a long day of sightseeing.'
    ],
    'Temple': [
        'A spiritually uplifting destination featuring magnificent ancient architecture and intricate carvings. Thousands of devotees visit daily to seek blessings and experience the divine tranquility. The temple premises are exceptionally well-maintained.',
        'Immerse yourself in the profound spiritual energy of this historic sacred site. The rituals and daily prayers offer a glimpse into centuries-old traditions. A must-visit landmark for anyone seeking peace and cultural enrichment.',
        'This prominent shrine stands as a testament to the region''s rich religious heritage. The peaceful surroundings and devotional chants create a mesmerizing atmosphere. Visitors often spend hours marveling at the majestic temple structures.'
    ],
    'Adventure Place': [
        'Embark on an exhilarating journey through scenic landscapes and lush greenery. This spot is perfect for nature enthusiasts and thrill-seekers looking to escape the city hustle. Ensure you carry adequate water and wear comfortable trekking shoes.',
        'Discover the raw beauty of nature with breathtaking views and challenging terrains. It is an ideal location for photography, group outings, and experiencing the great outdoors. The fresh air and natural serenity are truly rejuvenating.',
        'A fantastic outdoor destination that promises adventure and spectacular natural vistas. Whether you are a beginner or an experienced explorer, the trails here offer something for everyone. A great way to connect with nature.'
    ],
    'Hospital': [
        'A premier healthcare facility equipped with state-of-the-art medical technology. Staffed by highly qualified doctors and nurses, ensuring round-the-clock emergency and general care. Prioritizes patient comfort and rapid recovery.',
        'Dedicated to providing exceptional medical services with a compassionate approach. Features modern infrastructure and specialized departments for comprehensive healthcare. Trusted by the local community for reliable treatments.',
        'An advanced hospital offering 24/7 emergency services and specialized treatments. The facility maintains the highest standards of hygiene and patient care. A crucial healthcare pillar for residents and visitors alike.'
    ]
}

default_desc = 'A wonderful destination offering unique experiences for all visitors. Enjoy the beautiful surroundings and excellent amenities. A highly recommended stop on your Tirupati itinerary.'

with open('tirupati_places_with_hospitals.csv', 'r', encoding='utf-8') as f:
    reader = csv.reader(f)
    header = next(reader)
    rows = list(reader)

for row in rows:
    if len(row) >= 5:
        cat = row[1]
        desc_list = descriptions.get(cat, [default_desc])
        new_desc = random.choice(desc_list)
        # Combine the original short description with the new detailed one for context
        orig_desc = row[4].strip()
        row[4] = f"{orig_desc.capitalize()}. {new_desc}"

with open('tirupati_places_with_hospitals.csv', 'w', encoding='utf-8', newline='') as f:
    writer = csv.writer(f)
    writer.writerow(header)
    writer.writerows(rows)

print('CSV updated successfully.')
