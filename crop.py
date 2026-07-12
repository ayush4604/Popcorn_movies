from PIL import Image, ImageChops

def remove_white_border_and_make_transparent(image_path):
    img = Image.open(image_path).convert("RGBA")
    data = img.getdata()
    
    newData = []
    for item in data:
        # If the pixel is very close to white, make it transparent
        if item[0] > 240 and item[1] > 240 and item[2] > 240:
            newData.append((255, 255, 255, 0))
        else:
            newData.append(item)
            
    img.putdata(newData)
    
    # Auto-crop the transparent edges
    bbox = img.getbbox()
    if bbox:
        img = img.crop(bbox)
        
    img.save(image_path, "PNG")
    print(f"Processed {image_path}")

remove_white_border_and_make_transparent('frontend/public/icon.png')
